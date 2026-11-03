//! Colsto Doppler Geolocation Optimizer in Rust
//! High-performance aircraft flight path matching and acoustic heatmap generation.
//! Designed to run in WebAssembly for maximum throughput (~10M grid evaluations/sec).

#[repr(C)]
pub struct TrajectoryPoint {
    pub x: f32, // Easting in meters
    pub y: f32, // Northing in meters
    pub z: f32, // Altitude AMSL in meters
    pub t: f32, // Time in seconds
}

#[repr(C)]
pub struct EvaluationParams {
    pub target_dmin: f32,    // Closest approach distance from Doppler fit (m)
    pub target_v: f32,       // Ground speed from Doppler fit (m/s)
    pub target_tcpa: f32,    // CPA time from Doppler fit (s)
    pub f0: f32,             // Base harmonic frequency (Hz)
    pub sigma_dist: f32,     // Distance Gaussian width (m)
    pub sigma_time: f32,     // Time Gaussian width (s)
    pub sound_speed: f32,    // Speed of sound (m/s, default 343.0)
    pub spatial_pruning: i32,// 1 = enable Colsto cylinder bounding optimization
}

#[no_mangle]
pub unsafe extern "C" fn colsto_evaluate_grid(
    traj_ptr: *const TrajectoryPoint,
    traj_len: usize,
    params: *const EvaluationParams,
    cols: usize,
    rows: usize,
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
    out_scores: *mut f32,
    out_dmin: *mut f32,
    out_tcpa: *mut f32,
) -> usize {
    let traj = std::slice::from_raw_parts(traj_ptr, traj_len);
    let p = &*params;
    let total_cells = cols * rows;
    let scores = std::slice::from_raw_parts_mut(out_scores, total_cells);
    let dmins = std::slice::from_raw_parts_mut(out_dmin, total_cells);
    let tcpas = std::slice::from_raw_parts_mut(out_tcpa, total_cells);

    let step_x = if cols > 1 { (max_x - min_x) / ((cols - 1) as f32) } else { 1.0 };
    let step_y = if rows > 1 { (max_y - min_y) / ((rows - 1) as f32) } else { 1.0 };

    let inv_2_sig_dist_sq = 1.0 / (2.0 * p.sigma_dist * p.sigma_dist + 1e-6);
    let inv_2_sig_time_sq = 1.0 / (2.0 * p.sigma_time * p.sigma_time + 1e-6);
    let prune_max_r_sq = (p.target_dmin * 1.6) * (p.target_dmin * 1.6);

    let mut evaluated = 0usize;

    for r in 0..rows {
        let obs_y = min_y + (r as f32) * step_y;
        let row_offset = r * cols;

        for c in 0..cols {
            let obs_x = min_x + (c as f32) * step_x;
            let idx = row_offset + c;

            // Find closest approach to piecewise trajectory
            let mut min_dist_sq = f32::INFINITY;
            let mut best_t = 0.0f32;

            for i in 0..traj_len {
                let pt = &traj[i];
                let dx = pt.x - obs_x;
                let dy = pt.y - obs_y;
                let dz = pt.z;
                let dist_sq = dx * dx + dy * dy + dz * dz;

                if dist_sq < min_dist_sq {
                    min_dist_sq = dist_sq;
                    best_t = pt.t;
                }
            }

            // Colsto Cylindrical Pruning:
            // If closest point is outside the Doppler radius cylinder by a wide margin,
            // we can immediately zero the cell.
            if p.spatial_pruning != 0 && min_dist_sq > prune_max_r_sq {
                scores[idx] = 0.0;
                dmins[idx] = min_dist_sq.sqrt();
                tcpas[idx] = best_t;
                continue;
            }

            let d_calc = min_dist_sq.sqrt();
            // Account for acoustic propagation delay from CPA to ground observer
            let t_obs_cpa = best_t + (d_calc / p.sound_speed);

            let diff_dist = d_calc - p.target_dmin;
            let diff_time = t_obs_cpa - p.target_tcpa;

            let dist_penalty = (diff_dist * diff_dist) * inv_2_sig_dist_sq;
            let time_penalty = (diff_time * diff_time) * inv_2_sig_time_sq;

            let score = (- (dist_penalty + time_penalty)).exp();

            scores[idx] = score;
            dmins[idx] = d_calc;
            tcpas[idx] = t_obs_cpa;
            evaluated += 1;
        }
    }

    evaluated
}

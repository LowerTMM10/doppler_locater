// Home page: list of all tools. Add a new tool by adding an entry here.
const TOOLS = [
    {
        name: 'AeroDoppler',
        tag: 'OSINT DSP',
        description: 'Find a plane\'s Doppler curve in an audio recording and estimate its speed, closest distance and time of fly-over.',
        icon: 'fa-plane-departure',
        color: 'cyan',
        href: 'doppler_detector/',
        status: 'live'
    }
];

const COLORS = {
    cyan:    { box: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',       hover: 'hover:border-cyan-500/50' },
    emerald: { box: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', hover: 'hover:border-emerald-500/50' },
    violet:  { box: 'bg-violet-500/10 border-violet-500/30 text-violet-400',   hover: 'hover:border-violet-500/50' },
    rose:    { box: 'bg-rose-500/10 border-rose-500/30 text-rose-400',         hover: 'hover:border-rose-500/50' }
};

const grid = document.getElementById('toolGrid');
const search = document.getElementById('toolSearch');
const noResults = document.getElementById('noResults');

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toolCard(tool) {
    const c = COLORS[tool.color] || COLORS.cyan;
    const live = tool.status === 'live';
    const badge = live
        ? '<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">LIVE</span>'
        : '<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-700">SOON</span>';
    const tag = live ? 'a' : 'div';
    const link = live ? `href="${escapeHtml(tool.href)}"` : '';
    return `
        <${tag} ${link} class="group bg-slate-900/80 border border-slate-800 ${live ? c.hover + ' hover:-translate-y-0.5' : 'opacity-60'} rounded-xl p-4 flex flex-col gap-3 transition duration-150 shadow-lg">
            <div class="flex items-start justify-between">
                <div class="p-2.5 border rounded-lg ${c.box}">
                    <i class="fa-solid ${escapeHtml(tool.icon)} text-lg"></i>
                </div>
                ${badge}
            </div>
            <div>
                <h2 class="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    ${escapeHtml(tool.name)}
                    <span class="text-[10px] font-mono text-slate-500">${escapeHtml(tool.tag || '')}</span>
                </h2>
                <p class="text-xs text-slate-400 leading-relaxed mt-1">${escapeHtml(tool.description)}</p>
            </div>
            ${live ? '<span class="mt-auto text-xs font-semibold text-cyan-400 group-hover:text-cyan-300 flex items-center gap-1.5">Open tool <i class="fa-solid fa-arrow-right text-[10px]"></i></span>' : ''}
        </${tag}>`;
}

function render() {
    const q = search.value.trim().toLowerCase();
    const list = TOOLS.filter(t => !q || [t.name, t.tag, t.description].join(' ').toLowerCase().includes(q));
    grid.innerHTML = list.map(toolCard).join('');
    noResults.classList.toggle('hidden', list.length > 0);
}

search.addEventListener('input', render);
document.getElementById('toolCount').textContent = `${TOOLS.length} tool${TOOLS.length === 1 ? '' : 's'}`;
document.getElementById('year').textContent = new Date().getFullYear();
render();

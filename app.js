// Intelligently targets localhost if opened locally, or relative API paths in prod
const API_URL = "https://game.elso.win/api";
const START_LOCATION = { lat: 42.72611888883718, lng: -84.477101659417 };
let token = localStorage.getItem('scav_token');
let allChallenges = [];

async function fetchAPI(endpoint, options = {}) {
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    
    const fetchOptions = { ...options, headers };
    
    // Prevent aggressive browser caching of GET requests to ensure updates are instant
    if (!fetchOptions.method || fetchOptions.method.toUpperCase() === 'GET') {
        fetchOptions.cache = 'no-cache';
    }

    try {
        const res = await fetch(`${API_URL}${endpoint}`, fetchOptions);
        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
    } catch (err) {
        console.error(err);
        return { ok: false, error: err.message };
    }
}

async function init() {
    await loadState();
    const tName = localStorage.getItem('scav_team');
    
    if (tName === 'admin0') {
        document.getElementById('authPanel').classList.add('hidden');
        document.getElementById('teamPanel').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        await loadChallenges();
        return;
    }

    if (token) {
        document.getElementById('authPanel').classList.add('hidden');
        document.getElementById('teamPanel').classList.remove('hidden');
        document.getElementById('adminPanel').classList.add('hidden');
        
        document.getElementById('teamNameDisplay').innerText = tName || 'Loading...';

        await loadTeamInfo();
        await loadInventory();
    } else {
        document.getElementById('authPanel').classList.remove('hidden');
        document.getElementById('teamPanel').classList.add('hidden');
        document.getElementById('adminPanel').classList.add('hidden');
    }
    await loadChallenges();
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.innerText = '⏳ Refreshing...';
    await init();
    btn.innerText = '🔄 Refresh';
}

async function loadState() {
    const res = await fetchAPI('/state');
    const badge = document.getElementById('gameState');
    if (res.ok && res.data?.data) {
        const s = res.data.data;
        badge.innerText = s.is_active ? '🟢 OPERATION ACTIVE' : '🔴 STANDBY MODE';
        await checkGameOver(s);
    } else {
        badge.innerText = '⚠️ COMMS DOWN';
    }
}

async function checkGameOver(state) {
    const now = new Date();
    const start = state.game_start_time ? new Date(state.game_start_time) : null;
    const isOver = !state.is_active && start && now > start;

    const podiumPanel = document.getElementById('podiumPanel');
    
    if (isOver) {
        const lbRes = await fetchAPI('/leaderboard');
        if (lbRes.ok && lbRes.data?.data) {
            if(lbRes.data.meta?.scores_hidden) return; // Wait until scores are exposed
            const teams = lbRes.data.data;
            if(teams.length === 0) return;

            podiumPanel.classList.remove('hidden');
            
            const maxScore = Math.max(...teams.map(t => t.score), 1);
            const graph = document.getElementById('podiumGraph');
            graph.innerHTML = '';
            
            const top3 = teams.slice(0, 3);
            const displayOrder = [];
            if(top3[1]) displayOrder.push({ ...top3[1], rank: 2, class: 'silver' });
            displayOrder.push({ ...top3[0], rank: 1, class: 'gold' });
            if(top3[2]) displayOrder.push({ ...top3[2], rank: 3, class: 'bronze' });

            displayOrder.forEach(t => {
                const heightPct = Math.max((t.score / maxScore) * 80, 10); // Max 80% to leave room for the label
                const members = t.members && t.members.length ? `<br><span style="font-size:0.7em; font-weight:normal;">(${t.members.join(', ')})</span>` : '';
                graph.innerHTML += `
                    <div style="display:flex; flex-direction:column; justify-content:flex-end; align-items:center; flex: 1; height: 100%;">
                        <div class="podium-bar ${t.class}" style="height: ${heightPct}%;">
                            ${t.score} pts
                        </div>
                        <div class="podium-label">#${t.rank}<br>${t.team_name}${members}</div>
                    </div>
                `;
            });

            let listHtml = '<ul style="text-align:left; max-width: 400px; margin: 0 auto; list-style: none; padding:0;">';
            teams.slice(3).forEach((t, i) => {
                const members = t.members && t.members.length ? ` <span style="font-size:0.8em;">(${t.members.join(', ')})</span>` : '';
                listHtml += `<li style="padding: 5px; border-bottom: 1px dotted var(--border);"><strong>#${i + 4} ${t.team_name}</strong>${members} - ${t.score} pts</li>`;
            });
            listHtml += '</ul>';
            document.getElementById('podiumList').innerHTML = listHtml;
        }
    } else {
        podiumPanel.classList.add('hidden');
    }
}

function renderStartLocationMarker() {
    if (!map) return;

    if (startLocationMarker) {
        startLocationMarker.remove();
    }

    const el = document.createElement('div');
    el.className = 'map-marker start-location';
    el.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; width:100%; height:100%; font-size:0.72em; line-height:1;">START</div>';
    el.style.width = '42px';
    el.style.height = '42px';

    const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`
        <div style="text-align:center;">
            <h3 style="margin:0 0 5px 0;">Start Location</h3>
            <p style="margin:0; font-size:0.9em;">Initial meet-up point.</p>
        </div>
    `);

    startLocationMarker = new maplibregl.Marker({ element: el })
        .setLngLat([START_LOCATION.lng, START_LOCATION.lat])
        .setPopup(popup)
        .addTo(map);
}

async function loadTeamInfo() {
    const res = await fetchAPI('/team-info');
    if (res.ok) {
        const t = res.data?.data || res.data;
        if (t) {
            document.getElementById('teamNameDisplay').innerText = t.name || localStorage.getItem('scav_team');
            if (t.name) localStorage.setItem('scav_team', t.name); // Keep local cache synced for continuity
            document.getElementById('teamScore').innerText = t.score || 0;
            document.getElementById('teamMembers').innerText = (t.members || []).map(m => m.name).join(', ');
        }
    } else if (res.status === 404) {
        // If the server no longer knows this team, drop only the stale team cache.
        localStorage.removeItem('scav_team');
        document.getElementById('teamNameDisplay').innerText = 'No team';
        document.getElementById('teamScore').innerText = '0';
        document.getElementById('teamMembers').innerText = '';
    } else if (res.status === 401 || res.status === 403) {
        // Only logout if explicitly unauthorized, stopping network hiccups from wiping tokens
        logoutLocally();
    }
}

function logoutLocally() {
    localStorage.removeItem('scav_token');
    localStorage.removeItem('scav_player');
    localStorage.removeItem('scav_team');
    token = null;
    init();
}

async function loadInventory() {
    const res = await fetchAPI('/inventory');
    const list = document.getElementById('inventoryList');
    list.innerHTML = '';
    if (res.ok && res.data?.data) {
        const items = res.data.data;
        if (items.length === 0) return list.innerHTML = '<p><i>Pack is empty.</i></p>';
        items.forEach(i => {
            list.innerHTML += `
                <div class="inv-item">
                    <strong>[${i.id}] ${i.name} ${i.is_random ? '🎲' : ''}</strong><br>
                    Value: ${i.current_points} pts (Base: ${i.base_points})<br>
                    <button onclick="removeInventory(${i.id})" style="font-size: 0.8em; padding: 4px;">Drop Item</button>
                </div>
            `;
        });
    }
}

async function loadChallenges() {
    const res = await fetchAPI('/challenges');
    if (res.ok && res.data?.data) {
        allChallenges = res.data.data;
        renderChallenges();
    }
}

function renderChallenges() {
    const list = document.getElementById('challengesList');
    list.innerHTML = '';
    const search = document.getElementById('searchFilter').value.toLowerCase();

    allChallenges.filter(c => c.name.toLowerCase().includes(search) || c.description.toLowerCase().includes(search) || c.id.toString().includes(search)).forEach(c => {
        const card = document.createElement('div');
        card.className = 'card';
        if (c.claimed_by_team) card.classList.add('claimed');
        else if (c.remaining === 0) card.classList.add('exhausted');
        else if (c.blacklisted_by_team) card.classList.add('blacklisted');

        let status = c.remaining === -1 ? '' : `${c.remaining} remaining`;
        if (c.claimed_by_team) status = 'Claimed';
        if (c.blacklisted_by_team) status = 'Dropped';

        const statusTag = status ? `<span class="tag">${status}</span>` : '';

        let claimedByOthers = '';
        if (c.claimed_by_teams && c.claimed_by_teams.length > 0) {
            const otherTeams = c.claimed_by_teams.filter(t => t !== localStorage.getItem('scav_team'));
            if (otherTeams.length > 0) {
                claimedByOthers = `<div style="font-size: 0.85em; opacity: 0.8; margin-bottom: 10px;">🏆 <strong>Claimed by:</strong> ${otherTeams.join(', ')}</div>`;
            }
        }

        card.innerHTML = `
            <div>
                <h3><span>[${c.id}] ${c.name}</span> <span class="pts">${c.point_value} pts</span></h3>
                <p style="font-size: 0.9em;">${c.description}</p>
            </div>
            <div>
                <div style="margin-bottom: 10px; margin-top: 10px;">
                    <span class="tag">${c.category}</span>
                    ${statusTag}
                </div>
                ${claimedByOthers}
                <div>
                    ${token && !c.claimed_by_team && !c.blacklisted_by_team && c.remaining !== 0 ? `<button onclick="openClaimModal(${c.id}, '${c.category}', '${c.name.replace(/'/g, "\\'")}')">Claim</button>` : ''}
                    ${token && c.claimed_by_team ? `<button onclick="unclaim(${c.id})" style="background:var(--accent);">Undo Claim</button>` : ''}
                    ${token && !c.claimed_by_team && !c.blacklisted_by_team && c.remaining !== 0 ? `<button onclick="addInventory(${c.id})">Stow</button>` : ''}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

async function joinGame() {
    const pName = document.getElementById('playerName').value;
    const tName = document.getElementById('teamName').value;
    const dId = document.getElementById('discordId').value;
    if (!pName || !tName) return alert('Both fields required.');

    if (tName === 'admin0') {
        localStorage.setItem('scav_team', 'admin0');
        localStorage.setItem('scav_player', pName);
        init();
        return;
    }

    const body = { player_name: pName, team_name: tName };
    if (dId) body.discord_id = dId;

    const res = await fetchAPI('/join', { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
        token = res.data?.data?.token || res.data?.token;
        localStorage.setItem('scav_token', token);
        localStorage.setItem('scav_player', pName);
        localStorage.setItem('scav_team', tName);
        init();
    } else alert(res.data?.error || 'Join failed');
}

async function leaveGame() {
    if(!confirm('Are you sure you want to desert your team?')) return;
    const res = await fetchAPI('/leave', { method: 'DELETE' });
    if(res.ok) {
        logoutLocally();
    } else alert(res.data?.error || 'Failed to leave');
}

async function adminStartGame() {
    if(!confirm('Start/Schedule the game operation?')) return;
    
    const startTime = document.getElementById('adminStartTime').value;
    const endTime = document.getElementById('adminEndTime').value;
    const resetTeams = document.getElementById('adminResetTeams').checked;
    const csvFile = document.getElementById('adminCsv').files[0];
    const invSlots = document.getElementById('adminInvSlots').value;
    const invInc = document.getElementById('adminInvInc').value;
    const randVal = document.getElementById('adminRandVal').value;

    let options = { method: 'POST' };
    
    if (csvFile) {
        const fd = new FormData();
        fd.append('csv_file', csvFile);
        if (startTime) fd.append('start_time', new Date(startTime).toISOString());
        if (endTime) fd.append('end_time', new Date(endTime).toISOString());
        if (resetTeams) fd.append('reset_teams', 'true');
        if (invSlots) fd.append('inventory_slots', invSlots);
        if (invInc) fd.append('inventory_increase', invInc);
        if (randVal) fd.append('random_value', randVal);
        options.body = fd;
    } else {
        const body = { reset_teams: resetTeams };
        if (startTime) body.start_time = new Date(startTime).toISOString();
        if (endTime) body.end_time = new Date(endTime).toISOString();
        if (invSlots) body.inventory_slots = parseInt(invSlots, 10);
        if (invInc) body.inventory_increase = parseFloat(invInc);
        if (randVal) body.random_value = parseFloat(randVal);
        options.body = JSON.stringify(body);
    }

    const res = await fetchAPI('/admin/start', options);
    if(res.ok) init(); else alert(res.data?.error || 'Failed to start game');
}

async function adminStopGame() {
    if(!confirm('Halt the game operation?')) return;
    const endTime = document.getElementById('adminStopEndTime').value;
    const body = {};
    if (endTime) body.end_time = new Date(endTime).toISOString();

    const res = await fetchAPI('/admin/stop', { method: 'POST', body: JSON.stringify(body) });
    if(res.ok) init(); else alert(res.data?.error || 'Failed to stop game');
}

async function adminResumeGame() {
    if(!confirm('Resume the game operation?')) return;
    const res = await fetchAPI('/admin/resume', { method: 'POST' });
    if(res.ok) init(); else alert(res.data?.error || 'Failed to resume game');
}

async function adminShuffleTeams() {
    const count = document.getElementById('adminTeamCount').value;
    if(!count || count < 1) return alert('Enter a valid number of teams.');
    if(!confirm(`Randomly shuffle all current players into ${count} teams?`)) return;

    const res = await fetchAPI('/admin/teams/assign-random', {
        method: 'POST',
        body: JSON.stringify({ team_count: parseInt(count, 10) })
    });

    if(res.ok) {
        alert(`Successfully shuffled players into ${count} teams!`);
        init();
    } else alert(res.data?.error || 'Failed to shuffle teams');
}

async function adminCreateChallenge() {
    const name = document.getElementById('newChalName').value;
    const desc = document.getElementById('newChalDesc').value;
    const cat = document.getElementById('newChalCat').value;
    const pts = document.getElementById('newChalPts').value;
    const limit = document.getElementById('newChalLimit').value;
    const lat = document.getElementById('newChalLat').value;
    const lng = document.getElementById('newChalLng').value;

    if (!name || !desc || !cat || !pts) return alert('Name, Description, Category, and Points are required.');

    const body = { name, description: desc, category: cat, point_value: parseInt(pts, 10), limit: parseInt(limit, 10) };
    if (lat) body.latitude = parseFloat(lat);
    if (lng) body.longitude = parseFloat(lng);

    const res = await fetchAPI('/admin/challenges', { method: 'POST', body: JSON.stringify(body) });
    if(res.ok) {
        alert('Challenge created successfully!');
        ['Name', 'Desc', 'Cat', 'Lat', 'Lng'].forEach(id => document.getElementById(`newChal${id}`).value = '');
        document.getElementById('newChalPts').value = '10';
        document.getElementById('newChalLimit').value = '-1';
        init();
    } else {
        alert(res.data?.error || 'Failed to create challenge');
    }
}

// Modal Logic
function openClaimModal(id, category, name) {
    document.getElementById('claimChallengeId').value = id;
    document.getElementById('claimModalDesc').innerHTML = `Proving: ${name}`;
    const req = ['photo', 'video'].includes(category.toLowerCase());
    const mc = document.getElementById('mediaInputContainer');
    if (req) mc.classList.remove('hidden'); else mc.classList.add('hidden');
    document.getElementById('claimModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('claimModal').classList.add('hidden'); }

async function submitClaim() {
    const id = document.getElementById('claimChallengeId').value;
    const file = document.getElementById('claimMedia').files[0];
    const options = { method: 'POST' };
    if (file) {
        const fd = new FormData();
        fd.append('media', file);
        options.body = fd;
    }
    const res = await fetchAPI(`/challenges/${id}/claim`, options);
    if (res.ok) {
        alert(`Success! Awarded ${res.data?.data?.points_awarded || 'points'} pts!`);
        closeModal();
        init();
    } else alert(res.data?.error || 'Claim failed');
}

async function unclaim(id) {
    if(!confirm('Undo this claim? It will be moved to your inventory.')) return;
    const res = await fetchAPI(`/challenges/${id}/unclaim`, { method: 'POST' });
    if(res.ok) init(); else alert(res.data?.error || 'Failed to unclaim');
}

async function addInventory(id) {
    const res = await fetchAPI('/inventory', { method: 'POST', body: JSON.stringify({ challenge_id: id }) });
    if (res.ok) init(); else alert(res.data?.error || 'Failed to stow challenge');
}

async function removeInventory(id) {
    if(!confirm('Dropping this makes it permanently inaccessible. Proceed?')) return;
    const res = await fetchAPI(`/inventory/${id}`, { method: 'DELETE' });
    if(res.ok) init(); else alert(res.data?.error || 'Failed to drop');
}

async function addRandomInventory() {
    const res = await fetchAPI('/inventory', { method: 'POST', body: JSON.stringify({ random: true }) });
    if(res.ok) init(); else alert(res.data?.error || 'Failed to get random drop');
}

async function renameTeamPrompt() {
    const n = prompt("Enter new team name:");
    if (n) {
        const res = await fetchAPI('/teams/rename', { method: 'POST', body: JSON.stringify({ team_name: n }) });
        if (res.ok) {
            localStorage.setItem('scav_team', n);
            init();
        } else alert(res.data?.error || 'Failed');
    }
}

async function renamePlayerPrompt() {
    const n = prompt("Enter your new alias:");
    if (n) {
        const res = await fetchAPI('/player/rename', { method: 'POST', body: JSON.stringify({ player_name: n }) });
        if (res.ok) {
            localStorage.setItem('scav_player', n);
            init(); 
        } else alert(res.data?.error || 'Failed');
    }
}

async function linkDiscordPrompt() {
    const dId = prompt("Enter your numeric Discord ID (found by right-clicking your profile -> Copy User ID) to link your account:");
    if (dId) {
        const res = await fetchAPI('/player/link-discord', { method: 'POST', body: JSON.stringify({ discord_id: dId }) });
        if (res.ok) {
            alert('Discord linked successfully!');
        } else alert(res.data?.error || 'Failed to link Discord');
    }
}

// Soft polling to keep scores and active inventory values perfectly synced
setInterval(() => { if (token || localStorage.getItem('scav_team') === 'admin0') init(); }, 30000);

let map = null;
let currentMarkers = [];
let startLocationMarker = null;
let isMapVisible = false;
let pmtilesProtocolAdded = false;
let pmtilesInstance = null;

function toggleMap() {
    const mc = document.getElementById('mapContainer');
    const list = document.getElementById('challengesList');
    const btn = document.getElementById('mapToggleBtn');

    isMapVisible = !isMapVisible;

    if (isMapVisible) {
        mc.classList.remove('hidden');
        list.classList.add('hidden');
        btn.innerText = '📄 Show List';
        if (!map) {
            setTimeout(() => initMap(), 50); // Allow DOM to render display:block before calculating size
        } else {
            map.resize();
            renderMapMarkers();
        }
    } else {
        mc.classList.add('hidden');
        list.classList.remove('hidden');
        btn.innerText = '🗺️ Show Map';
    }
}

function initMap() {
    const PMTILES_URL = 'eastlansing.pmtiles';

    if (!pmtilesProtocolAdded) {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        
        pmtilesInstance = new pmtiles.PMTiles(PMTILES_URL);
        protocol.add(pmtilesInstance);
        
        pmtilesProtocolAdded = true;
    }

    // Fetch the header first, just like the working example
    pmtilesInstance.getHeader().then(h => {
        map = new maplibregl.Map({
            container: 'mapContainer',
            center: [-84.4822, 42.7325], // [lng, lat]
            zoom: 15,
            maxZoom: 18,
            style: {
                version: 8,
                sources: {
                    'protomaps': {
                        type: 'vector',
                        url: `pmtiles://${PMTILES_URL}`
                    }
                },
                layers: [
                    { id: 'landuse', type: 'fill', source: 'protomaps', 'source-layer': 'landuse', paint: { 'fill-color': '#dcd3b6' } },
                    { id: 'landcover', type: 'fill', source: 'protomaps', 'source-layer': 'landcover', paint: { 'fill-color': '#dcd3b6' } },
                    { id: 'park', type: 'fill', source: 'protomaps', 'source-layer': 'park', paint: { 'fill-color': '#c8ccaa' } },
                    { id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water', paint: { 'fill-color': '#9cb1c4' } },
                    { id: 'waterway', type: 'line', source: 'protomaps', 'source-layer': 'waterway', paint: { 'line-color': '#9cb1c4', 'line-width': 2 } },
                    { id: 'building', type: 'fill', source: 'protomaps', 'source-layer': 'building', paint: { 'fill-color': '#cfc4a6' } },
                    { id: 'transportation', type: 'line', source: 'protomaps', 'source-layer': 'transportation', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } },
                    { id: 'highway', type: 'line', source: 'protomaps', 'source-layer': 'highway', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } }
                ]
            }
        });

        map.on('load', () => {
            renderStartLocationMarker();
            renderMapMarkers();
        });
    }).catch(err => console.error("Error loading PMTiles header:", err));
}

function renderMapMarkers() {
    if (!map) return;

    renderStartLocationMarker();
    
    // Clear existing markers from the map
    currentMarkers.forEach(m => m.remove());
    currentMarkers = [];

    const search = document.getElementById('searchFilter').value.toLowerCase();
    const filtered = allChallenges.filter(c => c.name.toLowerCase().includes(search) || c.description.toLowerCase().includes(search) || c.id.toString().includes(search));

    let bounds = [];

    filtered.forEach(c => {
        if (c.latitude && c.longitude) {
            let markerClass = 'map-marker';
            if (c.claimed_by_team) markerClass += ' claimed';
            else if (c.remaining === 0) markerClass += ' exhausted';
            else if (c.blacklisted_by_team) markerClass += ' blacklisted';

            const el = document.createElement('div');
            el.className = markerClass;
            el.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; width:100%; height:100%; padding-top:2px;">${c.point_value}</div>`;
            el.style.width = '30px';
            el.style.height = '30px';

            let status = c.remaining === -1 ? '' : `${c.remaining} remaining`;
            if (c.claimed_by_team) status = 'Claimed';
            if (c.blacklisted_by_team) status = 'Dropped';
            const statusTag = status ? `<span class="tag">${status}</span>` : '';

            let claimBtn = '';
            if (token && !c.claimed_by_team && !c.blacklisted_by_team && c.remaining !== 0) {
                claimBtn = `<button onclick='openClaimModal(${c.id}, ${JSON.stringify(c.category)}, ${JSON.stringify(c.name)})' style="padding: 4px 8px; font-size: 0.8em; margin-top:10px;">Claim</button>`;
                claimBtn += `<button onclick="addInventory(${c.id})" style="padding: 4px 8px; font-size: 0.8em; margin-top:10px;">Stow</button>`;
            }

            let claimedByOthers = '';
            if (c.claimed_by_teams && c.claimed_by_teams.length > 0) {
                const otherTeams = c.claimed_by_teams.filter(t => t !== localStorage.getItem('scav_team'));
                if (otherTeams.length > 0) {
                    claimedByOthers = `<div style="font-size: 0.85em; opacity: 0.8; margin-bottom: 10px;">🏆 <strong>Claimed by:</strong> ${otherTeams.join(', ')}</div>`;
                }
            }

            const popupContent = `
                <div style="text-align:center;">
                    <h3 style="margin:0 0 5px 0;">[${c.id}] ${c.name}</h3>
                    <div style="margin-bottom: 5px;">
                        <span class="tag">${c.category}</span>
                        ${statusTag}
                    </div>
                    ${claimedByOthers}
                    <p style="margin:0; font-size:0.9em; max-height: 100px; overflow-y: auto;">${c.description}</p>
                    ${claimBtn}
                </div>
            `;

            const popup = new maplibregl.Popup({ offset: 15 }).setHTML(popupContent);

            const marker = new maplibregl.Marker({ element: el })
                .setLngLat([c.longitude, c.latitude])
                .setPopup(popup)
                .addTo(map);
                
            currentMarkers.push(marker);
            bounds.push([c.longitude, c.latitude]);
        }
    });

    if (bounds.length > 0) {
        const llb = new maplibregl.LngLatBounds(bounds[0], bounds[0]);
        for (const b of bounds) {
            llb.extend(b);
        }
        map.fitBounds(llb, { padding: 30, maxZoom: 18 });
    }
}

init();
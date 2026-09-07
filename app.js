const pages = document.querySelectorAll('.page');
const navButtons = document.querySelectorAll('.nav button');
const title = document.getElementById('pageTitle');
const form = document.getElementById('bookingForm');
const confirmBtn = document.getElementById('confirmBtn');
let lastAvailability = null;
let lastBooking = null;

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    navButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    pages.forEach((p) => p.classList.remove('active'));
    document.getElementById(btn.dataset.page).classList.add('active');
    title.textContent = btn.textContent;
    loadPage(btn.dataset.page);
  });
});

let staffToken = sessionStorage.getItem('meridianStaffToken') || '';

async function api(url, options) {
  const headers = { 'Content-Type': 'application/json', ...(options && options.headers) };
  if (staffToken) headers.Authorization = `Bearer ${staffToken}`;
  const res = await fetch(url, {
    ...options,
    headers
  });
  const data = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), data);
  return data;
}

function money(n) {
  return `R ${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWhen(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.replace('T', ' ');
  return d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadOverview() {
  const data = await api('/api/overview');
  document.getElementById('overviewStats').innerHTML = `
    <div class="card"><h3>Active fleet</h3><div class="value">${data.fleetSize}</div><div class="hint">65-seat coaches</div></div>
    <div class="card"><h3>Upcoming charters</h3><div class="value">${data.upcoming}</div><div class="hint">Confirmed future bookings</div></div>
    <div class="card"><h3>Open luggage</h3><div class="value">${data.openLuggage}</div><div class="hint">Items still to claim</div></div>
    <div class="card"><h3>Waiting calls</h3><div class="value">${data.waitingCalls}</div><div class="hint">Agent queue</div></div>
  `;
}

function formPayload() {
  const fd = new FormData(form);
  return {
    customerName: fd.get('customerName'),
    companyName: fd.get('companyName'),
    phone: fd.get('phone'),
    email: fd.get('email'),
    pickupLocation: fd.get('pickupLocation'),
    destination: fd.get('destination'),
    departureAt: fd.get('departureAt'),
    returnAt: fd.get('returnAt'),
    numberOfCoaches: Number(fd.get('numberOfCoaches') || 1),
    numberOfDays: Number(fd.get('numberOfDays') || 1),
    specialRequirements: fd.get('specialRequirements'),
    internalNotes: fd.get('internalNotes')
  };
}

function syncCoachControls() {
  const input = document.getElementById('numberOfCoaches');
  const n = Math.max(1, Number(input.value) || 1);
  input.value = n;
  const select = document.getElementById('coachSelect');
  if (select) select.value = String(Math.min(8, n));
  const parts = Array.from({ length: n }, () => '65').join(' + ');
  document.getElementById('cReq').textContent = n;
  document.getElementById('cExpr').textContent = parts;
  document.getElementById('cCap').textContent = `${n * 65} seats`;
  confirmBtn.textContent = `Confirm ${n} Coach Charter`;
}

async function refreshAvailability() {
  const p = formPayload();
  const msg = document.getElementById('availMsg');
  syncCoachControls();
  if (!p.numberOfCoaches || p.numberOfCoaches < 1 || !p.departureAt) {
    lastAvailability = null;
    confirmBtn.disabled = true;
    msg.className = 'msg info';
    msg.textContent = 'Select coaches and a departure date to check fleet availability.';
    document.getElementById('cAvail').textContent = '—';
    return;
  }
  try {
    const data = await api('/api/availability', { method: 'POST', body: JSON.stringify({
      numberOfCoaches: p.numberOfCoaches,
      departureAt: p.departureAt,
      returnAt: p.returnAt || p.departureAt
    })});
    lastAvailability = data;
    document.getElementById('cAvail').textContent = data.availableCoaches;
    document.getElementById('cCap').textContent = `${data.totalCapacity} seats`;
    document.getElementById('cExpr').textContent = data.capacityExpression;
    confirmBtn.textContent = `Confirm ${data.numberOfCoaches} Coach Charter`;
    if (data.enough) {
      confirmBtn.disabled = false;
      msg.className = 'msg ok';
      msg.textContent = `${data.checking} ${data.message}`;
    } else {
      confirmBtn.disabled = true;
      msg.className = 'msg bad';
      msg.textContent = data.blockMessage;
    }
  } catch (err) {
    lastAvailability = null;
    confirmBtn.disabled = true;
    msg.className = 'msg bad';
    msg.textContent = err.message;
  }
}

['numberOfCoaches', 'departureAt', 'returnAt'].forEach((name) => {
  form.elements[name].addEventListener('input', refreshAvailability);
  form.elements[name].addEventListener('change', refreshAvailability);
});

document.getElementById('coachMinus').onclick = () => {
  const input = document.getElementById('numberOfCoaches');
  input.value = Math.max(1, Number(input.value) - 1);
  refreshAvailability();
};
document.getElementById('coachPlus').onclick = () => {
  const input = document.getElementById('numberOfCoaches');
  input.value = Math.max(1, Number(input.value) + 1);
  refreshAvailability();
};
document.getElementById('coachSelect').onchange = () => {
  document.getElementById('numberOfCoaches').value = document.getElementById('coachSelect').value;
  refreshAvailability();
};

function renderReceipt(booking) {
  if (!booking) return;
  lastBooking = booking;
  document.getElementById('smsBtn').disabled = false;
  document.getElementById('waBtn').disabled = false;
  const coachLines = (booking.coaches || []).map((c) => `${c.code} — ${c.name} (${c.capacity} capacity)`).join('<br>');
  document.getElementById('receipt').innerHTML = `
    <h3>Meridian Coach Charter Receipt</h3>
    <p><strong>${booking.reference}</strong></p>
    <table>
      <tr><th>Customer</th><td>${booking.customer_name}${booking.company_name ? ' · ' + booking.company_name : ''}</td></tr>
      <tr><th>Route</th><td>${booking.pickup_location} → ${booking.destination}</td></tr>
      <tr><th>Departure Date</th><td>${formatWhen(booking.departure_at)}</td></tr>
      <tr><th>Return Date</th><td>${booking.return_at ? formatWhen(booking.return_at) : 'One way'}</td></tr>
      <tr><th>Number of Coaches</th><td>${booking.coaches_required}</td></tr>
      <tr><th>Seats Per Coach</th><td>65</td></tr>
      <tr><th>Capacity Calculation</th><td>${booking.capacity_expression || '65'}</td></tr>
      <tr><th>Total Capacity</th><td>${booking.total_capacity} seats</td></tr>
      <tr><th>Price Per Coach</th><td>${money(booking.price_per_coach)} × ${booking.number_of_days} day(s)</td></tr>
      <tr><th>Total Booking Price</th><td><strong>${money(booking.total_price)}</strong></td></tr>
      <tr><th>Coaches Assigned</th><td>${coachLines}</td></tr>
    </table>
  `;
}

function renderBookings(bookings) {
  if (!bookings.length) {
    document.getElementById('bookingTable').innerHTML = '<p class="muted">No bookings yet.</p>';
    return;
  }
  document.getElementById('bookingTable').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Reference</th><th>Customer</th><th>Route</th><th>When</th>
          <th>Coaches</th><th>Capacity</th><th>Assigned</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${bookings.map((b) => `
          <tr>
            <td>${b.reference}</td>
            <td>${b.customer_name}${b.company_name ? `<div class="muted">${b.company_name}</div>` : ''}</td>
            <td>${b.pickup_location} → ${b.destination}</td>
            <td>${formatWhen(b.departure_at)}</td>
            <td>${b.coaches_required}</td>
            <td>${b.capacity_expression || '65'} = ${b.total_capacity}</td>
            <td class="coaches">${(b.coaches || []).map((c) => `<span class="tag">${c.code} · 65</span>`).join('')}</td>
            <td><span class="badge ${b.status}">${b.status}</span></td>
            <td>
              <button class="btn ghost" data-view="${b.id}">Receipt</button>
              ${b.status !== 'cancelled' ? `<button class="btn danger" data-cancel="${b.id}">Cancel</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.onclick = async () => {
      const data = await api(`/api/bookings/${btn.dataset.view}`);
      renderReceipt(data.booking);
    };
  });
  document.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Cancel this charter and release its coaches?')) return;
      await api(`/api/bookings/${btn.dataset.cancel}/cancel`, { method: 'POST' });
      await loadBookings();
      await refreshAvailability();
    };
  });
}

async function loadBookings() {
  const data = await api('/api/bookings');
  renderBookings(data.bookings);
}

confirmBtn.addEventListener('click', async () => {
  confirmBtn.disabled = true;
  try {
    const data = await api('/api/bookings', { method: 'POST', body: JSON.stringify(formPayload()) });
    renderReceipt(data.booking);
    await loadBookings();
    await refreshAvailability();
    document.getElementById('availMsg').className = 'msg ok';
    document.getElementById('availMsg').textContent = `Booking ${data.booking.reference} confirmed with ${data.booking.coaches_required} coach(es).`;
  } catch (err) {
    document.getElementById('availMsg').className = 'msg bad';
    document.getElementById('availMsg').textContent = err.error || err.message;
    confirmBtn.disabled = !lastAvailability?.enough;
  }
});

document.getElementById('resetBtn').onclick = () => {
  form.reset();
  form.elements.numberOfDays.value = 1;
  refreshAvailability();
};

document.getElementById('smsBtn').onclick = async () => {
  if (!lastBooking) return;
  const data = await api(`/api/bookings/${lastBooking.id}/notify`, { method: 'POST', body: JSON.stringify({ channel: 'sms' }) });
  document.getElementById('availMsg').className = 'msg ok';
  document.getElementById('availMsg').textContent = data.message;
};

document.getElementById('waBtn').onclick = async () => {
  if (!lastBooking) return;
  const data = await api(`/api/bookings/${lastBooking.id}/notify`, { method: 'POST', body: JSON.stringify({ channel: 'whatsapp' }) });
  document.getElementById('availMsg').className = 'msg ok';
  document.getElementById('availMsg').textContent = data.message;
};

async function loadTrips() {
  const [routes, coaches] = await Promise.all([api('/api/routes'), api('/api/coaches')]);
  document.getElementById('routesCard').innerHTML = `
    <h3>Trips and routes</h3>
    <table><thead><tr><th>Route</th><th>Origin</th><th>Destination</th><th>Hours</th></tr></thead>
    <tbody>${routes.routes.map((r) => `<tr><td>${r.name}</td><td>${r.origin}</td><td>${r.destination}</td><td>${r.typical_hours}</td></tr>`).join('')}</tbody></table>
  `;
  document.getElementById('fleetCard').innerHTML = `
    <h3>Fleet</h3>
    <table><thead><tr><th>Code</th><th>Name</th><th>Capacity</th><th>Status</th></tr></thead>
    <tbody>${coaches.coaches.map((c) => `<tr><td>${c.code}</td><td>${c.name}</td><td>${c.capacity}</td><td>${c.status}</td></tr>`).join('')}</tbody></table>
  `;
}

async function loadPassengers() {
  const data = await api('/api/passengers');
  document.getElementById('passengerTable').innerHTML = data.passengers.length
    ? `<table><thead><tr><th>Name</th><th>Booking</th><th>Customer</th><th>Phone</th></tr></thead>
       <tbody>${data.passengers.map((p) => `<tr><td>${p.full_name}</td><td>${p.reference}</td><td>${p.customer_name}</td><td>${p.phone || '—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No passenger contact records yet. Charters are still whole-coach, not per-seat.</p>';
}

async function loadLuggage() {
  const data = await api('/api/luggage');
  document.getElementById('luggageTable').innerHTML = data.items.length
    ? `<table><thead><tr><th>Item</th><th>Booking</th><th>Coach</th><th>Status</th></tr></thead>
       <tbody>${data.items.map((i) => `<tr><td>${i.description}</td><td>${i.reference || '—'}</td><td>${i.coach_code || '—'}</td><td>${i.status}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No lost luggage reports.</p>';
}

document.getElementById('luggageBtn').onclick = async () => {
  const description = document.querySelector('#luggageForm [name=description]').value;
  await api('/api/luggage', { method: 'POST', body: JSON.stringify({ description }) });
  document.querySelector('#luggageForm [name=description]').value = '';
  loadLuggage();
};

document.getElementById('deskBtn').onclick = async () => {
  const question = document.getElementById('deskQ').value;
  const data = await api('/api/desk', { method: 'POST', body: JSON.stringify({ question }) });
  document.getElementById('deskA').textContent = data.answer;
};

async function loadQueue() {
  const data = await api('/api/queue');
  document.getElementById('queueCard').innerHTML = `
    <h3>Agent queue and calls</h3>
    <table><thead><tr><th>Caller</th><th>Phone</th><th>Topic</th><th>Status</th></tr></thead>
    <tbody>${data.queue.map((q) => `<tr><td>${q.caller_name}</td><td>${q.phone}</td><td>${q.topic}</td><td>${q.status}</td></tr>`).join('')}</tbody></table>
  `;
}

async function loadAudit() {
  const data = await api('/api/audit');
  document.getElementById('auditCard').innerHTML = `
    <h3>Audit log</h3>
    <table><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
    <tbody>${data.events.map((e) => `<tr><td>${e.created_at}</td><td>${e.action}</td><td>${e.entity_id || e.entity || ''}</td><td>${e.detail || ''}</td></tr>`).join('')}</tbody></table>
  `;
}

let agentProposalId = null;

function renderAgentSections(sections) {
  document.getElementById('agentSections').innerHTML = sections.map((s) => `
    <div class="section-block">
      <h4>[${s.section}] · v${s.version || 1}</h4>
      <pre class="preblock">${s.content}</pre>
    </div>
  `).join('');
}

async function loadAgentHistory() {
  const data = await api('/api/agent-instructions/history');
  document.getElementById('agentHistory').innerHTML = data.versions.length
    ? `<table><thead><tr><th>When</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>
      ${data.versions.map((v) => `<tr><td>${v.created_at}</td><td>${v.actor}</td><td>${v.note || ''}</td>
      <td><button class="btn ghost" data-restore="${v.id}">Restore Previous Version</button></td></tr>`).join('')}
      </tbody></table>`
    : '<p class="muted">No history yet.</p>';
  document.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Restore this previous version of all sections?')) return;
      const data = await api('/api/agent-instructions/restore', { method: 'POST', body: JSON.stringify({ versionId: Number(btn.dataset.restore) }) });
      renderAgentSections(data.sections);
      await loadAgentHistory();
    };
  });
}

async function loadAgentManager() {
  if (!staffToken) {
    document.getElementById('agentGate').classList.remove('hidden');
    document.getElementById('agentStudio').classList.add('hidden');
    return;
  }
  try {
    const data = await api('/api/agent-instructions');
    document.getElementById('agentGate').classList.add('hidden');
    document.getElementById('agentStudio').classList.remove('hidden');
    renderAgentSections(data.sections);
    await loadAgentHistory();
  } catch (err) {
    staffToken = '';
    sessionStorage.removeItem('meridianStaffToken');
    document.getElementById('agentGate').classList.remove('hidden');
    document.getElementById('agentStudio').classList.add('hidden');
    document.getElementById('agentGateMsg').className = 'msg bad';
    document.getElementById('agentGateMsg').textContent = err.message;
  }
}

document.getElementById('staffLoginBtn').onclick = async () => {
  try {
    const data = await api('/api/staff/login', { method: 'POST', body: JSON.stringify({ pin: document.getElementById('staffPin').value }) });
    staffToken = data.token;
    sessionStorage.setItem('meridianStaffToken', staffToken);
    document.getElementById('agentGateMsg').className = 'msg ok';
    document.getElementById('agentGateMsg').textContent = 'Signed in.';
    await loadAgentManager();
  } catch (err) {
    document.getElementById('agentGateMsg').className = 'msg bad';
    document.getElementById('agentGateMsg').textContent = err.message;
  }
};

document.getElementById('agentPreviewBtn').onclick = async () => {
  try {
    const data = await api('/api/agent-instructions/preview', {
      method: 'POST',
      body: JSON.stringify({ instruction: document.getElementById('agentInstruction').value })
    });
    agentProposalId = data.proposalId;
    document.getElementById('prevSection').textContent = data.section;
    document.getElementById('prevOld').textContent = data.previous;
    document.getElementById('prevNew').textContent = data.updated_content;
    document.getElementById('agentPreviewCard').classList.remove('hidden');
    document.getElementById('agentMsg').className = 'msg info';
    document.getElementById('agentMsg').textContent = `Section ${data.section} will change. Other sections stay the same.`;
  } catch (err) {
    document.getElementById('agentMsg').className = 'msg bad';
    document.getElementById('agentMsg').textContent = err.message;
  }
};

document.getElementById('agentApproveBtn').onclick = async () => {
  if (!agentProposalId) return;
  const data = await api('/api/agent-instructions/approve', { method: 'POST', body: JSON.stringify({ proposalId: agentProposalId }) });
  agentProposalId = null;
  document.getElementById('agentPreviewCard').classList.add('hidden');
  renderAgentSections(data.sections);
  await loadAgentHistory();
  document.getElementById('agentMsg').className = 'msg ok';
  document.getElementById('agentMsg').textContent = 'Saved. The voice agent API now returns the approved text.';
};

document.getElementById('agentCancelBtn').onclick = async () => {
  if (agentProposalId) {
    await api('/api/agent-instructions/cancel', { method: 'POST', body: JSON.stringify({ proposalId: agentProposalId }) });
  }
  agentProposalId = null;
  document.getElementById('agentPreviewCard').classList.add('hidden');
};

async function loadPage(page) {
  if (page === 'overview') return loadOverview();
  if (page === 'bookings') return loadBookings();
  if (page === 'trips') return loadTrips();
  if (page === 'passengers') return loadPassengers();
  if (page === 'luggage') return loadLuggage();
  if (page === 'agent') return loadAgentManager();
  if (page === 'queue') return loadQueue();
  if (page === 'audit') return loadAudit();
}

loadOverview();
refreshAvailability();

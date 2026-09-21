// Thin browser adapter: UI behavior lives here; scheduling/business rules live in Python/Flask.
const $ = (selector) => document.querySelector(selector);
let role = null;
let authMode = "login";
let customerDetails = null;
let selectedDate = null;
let selectedTime = null;

const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Something went wrong.");
  return data;
};

const localDateString = () => new Date().toISOString().slice(0, 10);
const prettyDate = (value) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3600);
}
function openModal(id) { $(`#${id}`).classList.remove("hidden"); }
function closeModal(id) { $(`#${id}`).classList.add("hidden"); }

function openAuth(nextRole) {
  role = nextRole; setAuthMode("login");
  const name = role === "doctor" ? "veterinarian" : "pet parent";
  $("#authEyebrow").textContent = `${name.toUpperCase()} ACCOUNT`;
  $("#authTitle").textContent = `Welcome, ${name}.`;
  $("#authDescription").textContent = "Sign in to your account or create one to continue.";
  openModal("authModal");
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === mode));
  $("#authSubmit").innerHTML = `${mode === "login" ? "Sign in" : "Create account"} <span>→</span>`;
}

async function enterPortal() {
  closeModal("authModal"); $("#landing").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#signOut").classList.remove("hidden"); $("#backHome").classList.remove("hidden");
  $("#viewTitle").innerHTML = `<span class="pulse"></span>${role === "doctor" ? "Veterinarian portal" : "Pet parent portal"}`;
  $("#doctorView").classList.toggle("hidden", role !== "doctor"); $("#customerView").classList.toggle("hidden", role !== "customer");
  if (role === "doctor") await renderDoctor();
}

async function renderDoctor() {
  const availability = (await api("/api/availability"));
  $("#doctorScheduleList").innerHTML = availability.map(item => `<div class="schedule-item"><div><b>${prettyDate(item.date)}</b><span>${item.start} — ${item.end}</span></div><span class="tag">Live</span></div>`).join("") || '<p class="empty">No availability published yet.</p>';
  const bookings = await api("/api/bookings");
  $("#bookingList").innerHTML = bookings.map(item => `<div class="booking-item"><div><b>${item.petName} <small>with ${item.ownerName}</small></b><small>${prettyDate(item.date)} · ${item.time} · ${item.types.join(", ")} · ${item.referenceCode}</small></div><span class="tag">Confirmed</span></div>`).join("") || '<p class="empty">Your confirmed appointments will appear here.</p>';
}

async function renderScheduleModal() {
  const availability = await api("/api/availability");
  const dates = availability.map(x => x.date);
  if (!dates.length) { $("#slotDates").innerHTML = ""; $("#slotList").innerHTML = '<p class="empty">No appointment windows have been published yet.</p>'; return; }
  selectedDate = dates.includes(selectedDate) ? selectedDate : dates[0];
  $("#slotDates").innerHTML = dates.map(d => `<button class="date-tab ${d === selectedDate ? "active" : ""}" data-date="${d}">${prettyDate(d)}</button>`).join("");
  $("#slotDates").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => { selectedDate = btn.dataset.date; selectedTime = null; $("#submitBooking").disabled = true; $("#selectedSlotMessage").textContent = "Select a time to continue."; renderScheduleModal(); }));
  const slots = (await api(`/api/slots/${selectedDate}`)).filter(slot => slot.state === "open");
  $("#slotList").innerHTML = slots.map(slot => `<button class="slot ${slot.time === selectedTime ? "selected" : ""}" data-time="${slot.time}">${slot.label}</button>`).join("") || '<p class="empty">No available appointment times remain for this date.</p>';
  $("#slotList").querySelectorAll(".slot").forEach(btn => btn.addEventListener("click", () => selectTime(btn.dataset.time)));
}
async function selectTime(time) { selectedTime = time; const label = (await api(`/api/slots/${selectedDate}`)).find(s => s.time === time)?.label || time; $("#selectedSlotMessage").textContent = `Selected: ${prettyDate(selectedDate)} at ${label}`; $("#submitBooking").disabled = false; renderScheduleModal(); }

async function submitBooking() {
  try {
    const data = { ...customerDetails, date: selectedDate, time: selectedTime };
    const result = await api("/api/bookings", { method: "POST", body: JSON.stringify(data) });
    closeModal("scheduleModal"); showConfirmation(result.booking); $("#petForm").reset(); $("#otherPetField").classList.add("hidden"); $("#otherPetType").required = false; $("#visitReasonField").classList.add("hidden"); $("#visitReason").required = false; customerDetails = null; selectedTime = null;
  } catch (error) { showToast(error.message); renderScheduleModal(); }
}
function showConfirmation(booking) {
  $("#referenceCode").textContent = booking.referenceCode;
  const appointmentType = booking.types.map(type => type === "Others" && booking.visitReason ? `Others — ${booking.visitReason}` : type).join(", ");
  $("#confirmationDetails").innerHTML = `<b>${booking.petName}</b> (${booking.petType}) · ${prettyDate(booking.date)} at ${booking.time}<br>Appointment type: ${appointmentType}`;
  $("#confirmationReport").textContent = booking.summary; openModal("confirmationModal");
}
function renderLookup(booking) {
  const result = $("#lookupResult");
  if (!booking) { result.innerHTML = '<p class="form-message">No appointment matched that reference code.</p>'; return; }
  const appointmentType = booking.types.map(type => type === "Others" && booking.visitReason ? `Others — ${booking.visitReason}` : type).join(", ");
  result.innerHTML = `<div class="schedule-item"><div><b>${booking.petName} <small>with ${booking.ownerName}</small></b><span>${prettyDate(booking.date)} · ${booking.time} · ${booking.referenceCode}</span></div><span class="tag">Verified</span></div><div class="report-box"><b>Customer intake</b><p>Owner: ${booking.ownerName}<br>Pet type: ${booking.petType}<br>Address: ${booking.address}<br>Contact: ${booking.contact}<br>Appointment type: ${appointmentType}</p></div><div class="report-box"><b>Visit summary report</b><p>${booking.summary}</p></div>`;
}

$("#availabilityDate").value = localDateString();
document.querySelectorAll("[data-role]").forEach(button => button.addEventListener("click", () => openAuth(button.dataset.role)));
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => closeModal(button.dataset.close)));
document.querySelectorAll(".auth-tab").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.mode)));
$("#authForm").addEventListener("submit", e => { e.preventDefault(); enterPortal(); });
$("#availabilityForm").addEventListener("submit", async e => { e.preventDefault(); const f = e.currentTarget; try { await api("/api/availability", { method: "POST", body: JSON.stringify({ date: f.availabilityDate.value, start: f.startTime.value, end: f.endTime.value }) }); $("#availabilityMessage").textContent = "Availability is now live for pet parents."; await renderDoctor(); } catch (error) { $("#availabilityMessage").textContent = error.message; } });
$("#petForm").addEventListener("submit", e => { e.preventDefault(); const f = e.currentTarget; const types = [...f.querySelectorAll('input[name="appointmentType"]:checked')].map(x => x.value); if (!types.length) { $("#petMessage").textContent = "Please choose at least one appointment type."; return; } const data = Object.fromEntries(new FormData(f)); const petType = data.petType === "Others" ? data.otherPetType.trim() : data.petType; if (!petType) { $("#petMessage").textContent = "Please specify the pet type."; return; } if (types.includes("Others") && !data.visitReason.trim()) { $("#petMessage").textContent = "Please specify your appointment/service when 'Others' is selected."; return; } customerDetails = { ownerName: data.ownerName, petName: data.petName, petType, visitReason: data.visitReason || "", address: data.address, contact: data.contact, types }; selectedDate = null; selectedTime = null; $("#submitBooking").disabled = true; $("#selectedSlotMessage").textContent = "Select a time to continue."; $("#petMessage").textContent = ""; openModal("scheduleModal"); renderScheduleModal(); });
$("#submitBooking").addEventListener("click", submitBooking);
$("#petType").addEventListener("change", e => { const other = e.target.value === "Others"; $("#otherPetField").classList.toggle("hidden", !other); $("#otherPetType").required = other; if (!other) $("#otherPetType").value = ""; });
document.querySelectorAll('input[name="appointmentType"]').forEach(input => input.addEventListener("change", () => { const other = [...document.querySelectorAll('input[name="appointmentType"]:checked')].some(x => x.value === "Others"); $("#visitReasonField").classList.toggle("hidden", !other); $("#visitReason").required = other; if (!other) $("#visitReason").value = ""; }));
$("#copyReference").addEventListener("click", async () => { const code = $("#referenceCode").textContent; try { await navigator.clipboard.writeText(code); $("#copyReference").textContent = "Copied!"; setTimeout(() => $("#copyReference").textContent = "Copy", 1800); } catch { showToast("Unable to copy automatically. Please copy the reference code manually."); } });
$("#confirmationDone").addEventListener("click", () => $("#homeBtn").click());
$("#referenceLookupForm").addEventListener("submit", async e => { e.preventDefault(); try { renderLookup((await api(`/api/bookings/${encodeURIComponent($("#referenceInput").value)}`)).booking); } catch (error) { showToast(error.message); } });
$("#homeBtn").addEventListener("click", () => { closeModal("authModal"); closeModal("scheduleModal"); closeModal("confirmationModal"); $("#app").classList.add("hidden"); $("#landing").classList.remove("hidden"); $("#signOut").classList.add("hidden"); $("#backHome").classList.add("hidden"); $("#viewTitle").innerHTML = '<span class="pulse"></span>Veterinary care, made simple'; customerDetails = null; selectedTime = null; role = null; });
$("#signOut").addEventListener("click", () => $("#homeBtn").click());
$("#backHome").addEventListener("click", () => $("#homeBtn").click());

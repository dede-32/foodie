const LS_KEY = "meal_picker_state_v1";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function uniq(arr) { return Array.from(new Set(arr)).sort((a,b)=>a.localeCompare(b, "cs")); }

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { favorites: [], cooked: {}, blockedUntil: {}, customFoods: [] };
    const s = JSON.parse(raw);
    return {
      favorites: Array.isArray(s.favorites) ? s.favorites : [],
      cooked: s.cooked && typeof s.cooked === "object" ? s.cooked : {},
      blockedUntil: s.blockedUntil && typeof s.blockedUntil === "object" ? s.blockedUntil : {},
      customFoods: Array.isArray(s.customFoods) ? s.customFoods : []
    };
  } catch {
    return { favorites: [], cooked: {}, blockedUntil: {}, customFoods: [] };
  }
}
function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function isBlocked(state, foodId) {
  const until = state.blockedUntil[foodId];
  if (!until) return false;
  return todayISO() <= until;
}
function cookedRecentlyPenalty(state, foodId) {
  // jednoduchý „neopakuj často“: pokud uvařeno dnes/pár dní, sniž šanci
  const last = state.cooked[foodId];
  if (!last) return 1.0;
  const t = todayISO();
  if (last === t) return 0.05;              // dnes skoro nikdy
  if (t <= addDaysISO(last, 2)) return 0.25; // do 2 dnů méně
  if (t <= addDaysISO(last, 5)) return 0.6;  // do 5 dnů trochu méně
  return 1.0;
}
function favoriteBoost(state, foodId) {
  return state.favorites.includes(foodId) ? 1.4 : 1.0;
}

function weightedPick(items, weights) {
  let sum = 0;
  for (const w of weights) sum += w;
  if (sum <= 0) return null;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1] ?? null;
}

let db = null;
let state = loadState();
let lastPick = null;

const el = (id) => document.getElementById(id);

function setResult(food, note = "") {
  const box = el("result");
  if (!food) {
    box.textContent = "Nic nevyhovuje filtrům. Zkus zvednout max. čas nebo zrušit filtry.";
    box.classList.add("muted");
  } else {
    box.classList.remove("muted");
    const tags = (food.tags ?? []).join(", ");
    const methods = (food.methods ?? []).join(", ");
    box.innerHTML = `
      <div><strong>${food.name}</strong></div>
      <div class="muted">Čas: ${food.time_min ?? "?"} min • Obtížnost: ${food.difficulty ?? "?"}/3</div>
      <div class="muted">Kuchyně: ${food.cuisine ?? "-"} • Metoda: ${methods || "-"}</div>
      <div class="muted">Tagy: ${tags || "-"}</div>
      ${note ? `<div class="muted" style="margin-top:8px;">${note}</div>` : ``}
    `;
  }
  el("btnFav").disabled = !food;
  el("btnCooked").disabled = !food;
  el("btnSkip").disabled = !food;
  refreshDebug();
}

function refreshDebug() {
  el("debug").textContent = JSON.stringify({ state, lastPickId: lastPick?.id ?? null }, null, 2);
}

function readFilters() {
  const maxTime = Number(el("maxTime").value || 9999);
  const cuisine = el("cuisine").value;
  const method = el("method").value;
  const tag = el("tag").value;
  return { maxTime, cuisine, method, tag };
}

function applyFilters(foods, f) {
  return foods.filter(x => {
    if (typeof x.time_min === "number" && x.time_min > f.maxTime) return false;
    if (f.cuisine && x.cuisine !== f.cuisine) return false;
    if (f.method && !(x.methods ?? []).includes(f.method)) return false;
    if (f.tag && !(x.tags ?? []).includes(f.tag)) return false;
    if (isBlocked(state, x.id)) return false;
    return true;
  });
}

function pickFood() {
  const allFoods = [...(db?.foods ?? []), ...(state.customFoods ?? [])];

  const f = readFilters();
  const candidates = applyFilters(allFoods, f);

  if (candidates.length === 0) {
    lastPick = null;
    setResult(null);
    return;
  }

  const weights = candidates.map(food => {
    const base = typeof food.weight === "number" ? food.weight : 1.0;
    return base * favoriteBoost(state, food.id) * cookedRecentlyPenalty(state, food.id);
  });

  lastPick = weightedPick(candidates, weights);
  setResult(lastPick);
}

function fillFilterOptions() {
  const allFoods = [...(db?.foods ?? []), ...(state.customFoods ?? [])];

  const cuisines = uniq(allFoods.map(x => x.cuisine).filter(Boolean));
  const methods = uniq(allFoods.flatMap(x => x.methods ?? []).filter(Boolean));
  const tags = uniq(allFoods.flatMap(x => x.tags ?? []).filter(Boolean));

  const selCuisine = el("cuisine");
  const selMethod = el("method");
  const selTag = el("tag");

  const keep = (sel) => sel.value;

  const prevCuisine = keep(selCuisine);
  const prevMethod = keep(selMethod);
  const prevTag = keep(selTag);

  selCuisine.innerHTML = `<option value="">(libovolně)</option>` + cuisines.map(c => `<option>${c}</option>`).join("");
  selMethod.innerHTML = `<option value="">(libovolně)</option>` + methods.map(m => `<option>${m}</option>`).join("");
  selTag.innerHTML = `<option value="">(libovolně)</option>` + tags.map(t => `<option>${t}</option>`).join("");

  // obnovit původní volbu, pokud stále existuje
  if (cuisines.includes(prevCuisine)) selCuisine.value = prevCuisine;
  if (methods.includes(prevMethod)) selMethod.value = prevMethod;
  if (tags.includes(prevTag)) selTag.value = prevTag;
}

async function loadDB() {
  const res = await fetch("foods.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Nepodařilo se načíst foods.json");
  const data = await res.json();
  if (!data || !Array.isArray(data.foods)) throw new Error("Špatný formát foods.json");
  db = data;
}

function toggleFavorite() {
  if (!lastPick) return;
  const id = lastPick.id;
  const idx = state.favorites.indexOf(id);
  if (idx >= 0) state.favorites.splice(idx, 1);
  else state.favorites.push(id);
  saveState(state);
  setResult(lastPick, state.favorites.includes(id) ? "Přidáno do oblíbených." : "Odebráno z oblíbených.");
}

function markCookedToday() {
  if (!lastPick) return;
  state.cooked[lastPick.id] = todayISO();
  saveState(state);
  setResult(lastPick, "Uloženo: uvařeno dnes (sníží se šance opakování).");
}

function block7Days() {
  if (!lastPick) return;
  state.blockedUntil[lastPick.id] = addDaysISO(todayISO(), 7);
  saveState(state);
  setResult(lastPick, `Skryto do ${state.blockedUntil[lastPick.id]}.`);
}

function exportState() {
  const payload = {
    exported_at: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "meal-picker-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result));
      if (!payload || !payload.state) throw new Error("Neplatný export.");
      state = payload.state;
      saveState(state);
      fillFilterOptions();
      setResult(lastPick, "Import hotový.");
    } catch (e) {
      alert("Import selhal: " + (e?.message ?? e));
    }
  };
  reader.readAsText(file);
}

function clearLocal() {
  if (!confirm("Opravdu smazat lokální data (oblíbené, historie, blokace, vlastní jídla)?")) return;
  localStorage.removeItem(LS_KEY);
  state = loadState();
  fillFilterOptions();
  lastPick = null;
  setResult(null, "Lokální data smazána.");
}

function resetFilters() {
  el("maxTime").value = 45;
  el("cuisine").value = "";
  el("method").value = "";
  el("tag").value = "";
}

function wireUI() {
  el("btnPick").addEventListener("click", pickFood);
  el("btnAgain").addEventListener("click", pickFood);
  el("btnReset").addEventListener("click", () => { resetFilters(); pickFood(); });

  el("btnFav").addEventListener("click", toggleFavorite);
  el("btnCooked").addEventListener("click", markCookedToday);
  el("btnSkip").addEventListener("click", block7Days);

  el("btnExport").addEventListener("click", exportState);
  el("importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importState(f);
    e.target.value = "";
  });
  el("btnClearLocal").addEventListener("click", clearLocal);

  // auto-pick když měníš filtry
  ["maxTime", "cuisine", "method", "tag"].forEach(id => {
    el(id).addEventListener("change", () => pickFood());
  });
}

(async function main() {
  wireUI();
  setResult(null);

  try {
    await loadDB();
    fillFilterOptions();
    setResult(null, "Databáze načtena. Nastav filtry a losuj 🙂");
  } catch (e) {
    setResult(null, "Chyba: " + (e?.message ?? e));
  }

  refreshDebug();
})();
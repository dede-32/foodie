let db = null;
let lastPick = null;
let isSpinning = false;

// Posunutá verze klíče, jelikož jsme změnili datovou strukturu (smazali customFoods)
const LS_KEY = "meal_picker_state_v4";

const el = (id) => document.getElementById(id);

function uniq(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "cs"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      return { favorites: [], cooked: {}, blockedUntil: {} };
    }

    const parsed = JSON.parse(raw);
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      cooked: parsed.cooked && typeof parsed.cooked === "object" ? parsed.cooked : {},
      blockedUntil: parsed.blockedUntil && typeof parsed.blockedUntil === "object" ? parsed.blockedUntil : {}
    };
  } catch {
    return { favorites: [], cooked: {}, blockedUntil: {} };
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  refreshDebug();
}

function getAllFoods() {
  return [...(db?.foods ?? [])];
}

function isFavorite(foodId) {
  return state.favorites.includes(foodId);
}

function isBlocked(foodId) {
  const until = state.blockedUntil[foodId];
  if (!until) return false;
  return todayISO() <= until;
}

function favoriteBoost(foodId) {
  return isFavorite(foodId) ? 1.4 : 1.0;
}

function cookedRecentlyPenalty(foodId) {
  const last = state.cooked[foodId];
  if (!last) return 1.0;

  const today = todayISO();
  if (last === today) return 0.05;
  if (today <= addDaysISO(last, 2)) return 0.25;
  if (today <= addDaysISO(last, 5)) return 0.6;

  return 1.0;
}

function weightedPick(items) {
  const weights = items.map((item) => {
    const baseWeight = Number(item.weight);
    const safeBase = Number.isFinite(baseWeight) && baseWeight > 0 ? baseWeight : 1;
    return safeBase * favoriteBoost(item.id) * cookedRecentlyPenalty(item.id);
  });

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;

  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }

  return items[items.length - 1] ?? null;
}

async function loadDB() {
  const res = await fetch("foods.json", { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Nepodařilo se načíst foods.json (${res.status})`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("foods.json není validní JSON");
  }

  if (!data || !Array.isArray(data.foods)) {
    throw new Error("Špatný formát foods.json: chybí pole foods");
  }

  db = data;
}

// --- MULTI-SELECT LOGIKA ---
const msInstances = {};

function initMultiSelect(containerId, optionsList, placeholderText = "Hledat...") {
  const container = el(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="ms-header">
      <div class="ms-chips"></div>
      <input type="text" class="ms-search" placeholder="${placeholderText}">
    </div>
    <div class="ms-dropdown"></div>
  `;

  const header = container.querySelector('.ms-header');
  const searchInput = container.querySelector('.ms-search');
  const dropdown = container.querySelector('.ms-dropdown');
  const chipsContainer = container.querySelector('.ms-chips');

  let selected = new Set();

  function renderDropdown(filter = "") {
    const term = filter.toLowerCase().trim();
    const available = optionsList.filter(o => !selected.has(o) && o.toLowerCase().includes(term));

    if (available.length === 0) {
      dropdown.innerHTML = `<div class="ms-empty">Nic nenalezeno</div>`;
      return;
    }

    dropdown.innerHTML = available.map(o => `
      <div class="ms-option" data-val="${escapeHtml(o)}">${escapeHtml(o)}</div>
    `).join('');
  }

  function renderChips() {
    chipsContainer.innerHTML = Array.from(selected).map(o => `
      <span class="ms-chip">
        ${escapeHtml(o)} 
        <span class="ms-chip-remove" data-val="${escapeHtml(o)}">×</span>
      </span>
    `).join('');
    searchInput.placeholder = selected.size > 0 ? "" : placeholderText;
  }

  header.addEventListener('click', () => {
    searchInput.focus();
    renderDropdown(searchInput.value);
    dropdown.style.display = 'block';
  });

  searchInput.addEventListener('input', (e) => {
    renderDropdown(e.target.value);
    dropdown.style.display = 'block';
  });

  dropdown.addEventListener('click', (e) => {
    if (e.target.classList.contains('ms-option')) {
      const val = e.target.getAttribute('data-val');
      selected.add(val);
      searchInput.value = '';
      renderChips();
      dropdown.style.display = 'none';
      searchInput.focus();
    }
  });

  chipsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('ms-chip-remove')) {
      const val = e.target.getAttribute('data-val');
      selected.delete(val);
      renderChips();
      renderDropdown(searchInput.value); 
      e.stopPropagation();
    }
  });

  msInstances[containerId] = {
    getSelected: () => Array.from(selected),
    reset: () => {
      selected.clear();
      searchInput.value = '';
      renderChips();
      dropdown.style.display = 'none';
    }
  };
}

document.addEventListener('click', (e) => {
  document.querySelectorAll('.multi-select').forEach(ms => {
    if (!ms.contains(e.target)) {
      ms.querySelector('.ms-dropdown').style.display = 'none';
    }
  });
});

function fillFilterOptions() {
  const foods = getAllFoods();

  const mealTypes = uniq(foods.flatMap((x) => asArray(x.meal_type)).filter(Boolean));
  const timeCategories = uniq(foods.map(x => x.time_category).filter(Boolean));
  const tags = uniq(foods.flatMap((x) => asArray(x.tags)).filter(Boolean));
  const methods = uniq(foods.flatMap((x) => asArray(x.methods)).filter(Boolean));
  const ingredients = uniq(foods.flatMap((x) => asArray(x.ingredients)).filter(Boolean));

  initMultiSelect("ms-mealType", mealTypes, "Vyberte typ...");
  initMultiSelect("ms-timeCategory", timeCategories, "Vyberte čas...");
  initMultiSelect("ms-tags", tags, "Hledat tag...");
  initMultiSelect("ms-methods", methods, "Vyberte přípravu...");
  initMultiSelect("ms-ingredients", ingredients, "Hledat surovinu...");
}

function readFilters() {
  return {
    mealTypes: msInstances["ms-mealType"]?.getSelected() || [],
    timeCategories: msInstances["ms-timeCategory"]?.getSelected() || [],
    tags: msInstances["ms-tags"]?.getSelected() || [],
    methods: msInstances["ms-methods"]?.getSelected() || [],
    ingredients: msInstances["ms-ingredients"]?.getSelected() || []
  };
}

function matchesAny(selected, values) {
  if (!selected.length) return true;
  return selected.some((item) => values.includes(item));
}

function applyFilters(foods, filters) {
  return foods.filter((food) => {
    const mealType = asArray(food.meal_type);
    const tags = asArray(food.tags);
    const methods = asArray(food.methods);
    const ingredients = asArray(food.ingredients);
    const timeCategory = food.time_category ? [food.time_category] : [];

    if (!matchesAny(filters.mealTypes, mealType)) return false;
    if (!matchesAny(filters.timeCategories, timeCategory)) return false;
    if (!matchesAny(filters.tags, tags)) return false;
    if (!matchesAny(filters.methods, methods)) return false;
    if (!matchesAny(filters.ingredients, ingredients)) return false;
    if (isBlocked(food.id)) return false;

    return true;
  });
}

function setInitialMessage() {
  const container = el("resultContainer");
  const box = el("result");
  const imgContainer = el("resultImageContainer");

  container.classList.add("muted");
  imgContainer.style.display = "none";
  box.textContent = "Klikni na „Vylosuj jídlo“.";

  // --- TADY JE ZMĚNA: Vrátíme původní text na tlačítko ---
  const pickBtn = el("btnPick");
  if (pickBtn) {
      pickBtn.textContent = "Vylosuj jídlo";
  }
}

function setNoMatchMessage() {
  const container = el("resultContainer");
  const box = el("result");
  const imgContainer = el("resultImageContainer");

  container.classList.add("muted");
  imgContainer.style.display = "none";
  box.textContent = "Nic nevyhovuje filtrům.";
}

function setResult(food, note = "") {
  const container = el("resultContainer");
  const box = el("result");
  const imgContainer = el("resultImageContainer");
  const imgEl = el("resultImage");

  if (!food) {
    setNoMatchMessage();
    updateActionButtons();
    return;
  }

  container.classList.remove("muted");

  // Ošetření a zobrazení obrázku
if (food.img) {
      imgEl.src = food.img;
      imgContainer.style.display = "block";
      
      // Pokud obrázek neexistuje (chyba 404), nastavit placeholder
      imgEl.onerror = function() {
          // Zde zadej cestu ke svému placeholderu
          imgEl.src = "images/placeholder.webp"; 
          console.log(`Použit placeholder pro: ${food.name}`);
          
          // Zamezíme nekonečné smyčce, kdyby chyběl i placeholder
          imgEl.onerror = null; 
      };
  } else {
      // Pokud v JSONu img vůbec není, rovnou dáme placeholder
      imgEl.src = "images/placeholder.webp";
      imgContainer.style.display = "block";
  }

  const mealType = asArray(food.meal_type);
  const methods = asArray(food.methods);
  const ingredients = asArray(food.ingredients);
  const tags = asArray(food.tags);

  const badges = [];

  if (food.time_category) {
    badges.push(`<span class="badge">${escapeHtml(food.time_category)} min</span>`);
  }

  for (const t of tags) {
    badges.push(`<span class="badge">${escapeHtml(t)}</span>`);
  }

  if (isFavorite(food.id)) {
    badges.push(`<span class="badge favorite">⭐ Oblíbené</span>`);
  }

  if (isBlocked(food.id)) {
    badges.push(`<span class="badge blocked">Skryto do ${escapeHtml(state.blockedUntil[food.id])}</span>`);
  }

  const cookedInfo = state.cooked[food.id]
    ? `<div class="muted">Naposledy vařeno: ${escapeHtml(state.cooked[food.id])}</div>`
    : "";

  box.innerHTML = `
    <div class="result-title">${escapeHtml(food.name ?? "-")}</div>
    <div class="badges">${badges.join("") || `<span class="badge">Bez štítků</span>`}</div>

    <div class="meta">
      <div><strong>Typ jídla:</strong> ${mealType.length ? escapeHtml(mealType.join(", ")) : "-"}</div>
      <div><strong>Příprava:</strong> ${methods.length ? escapeHtml(methods.join(", ")) : "-"}</div>
      <div><strong>Suroviny:</strong> ${ingredients.length ? escapeHtml(ingredients.join(", ")) : "-"}</div>
      ${cookedInfo}
      ${note ? `<div class="muted">${escapeHtml(note)}</div>` : ""}
    </div>
  `;

  // --- NOVINKA: Změní text hlavního tlačítka ---
  const pickBtn = el("btnPick");
  if (pickBtn) {
      pickBtn.textContent = "Zkus to znovu";
  }

  updateActionButtons();
}

function updateActionButtons() {
  const disabled = !lastPick;
  el("btnFav").disabled = disabled;
  el("btnCooked").disabled = disabled;
  el("btnSkip").disabled = disabled;

  if (!disabled && lastPick) {
    el("btnFav").textContent = isFavorite(lastPick.id) ? "⭐ Odebrat z oblíbených" : "⭐ Oblíbené";
  } else {
    el("btnFav").textContent = "⭐ Oblíbené";
  }
}

function pickFood() {
  if (isSpinning) return;

  const foods = getAllFoods();
  const filters = readFilters();
  const candidates = applyFilters(foods, filters);

  if (candidates.length === 0) {
    lastPick = null;
    setNoMatchMessage();
    updateActionButtons();
    return;
  }

  isSpinning = true;
  el("btnPick").disabled = true;
  // Smazáno: el("btnAgain").disabled = true;

  const container = el("resultContainer");
  const box = el("result");
  const imgContainer = el("resultImageContainer");

  container.classList.remove("muted");
  imgContainer.style.display = "none"; // Během animace obrázek schováme

  let spins = 0;
  const maxSpins = 15; 
  const spinInterval = 70;

  const spinTimer = setInterval(() => {
    const randomCandidate = candidates[Math.floor(Math.random() * candidates.length)];
    box.innerHTML = `<div class="result-title spin-text">${escapeHtml(randomCandidate.name)}</div>`;
    spins++;

    if (spins >= maxSpins) {
      clearInterval(spinTimer);
      
      // Vybereme finální jídlo se zohledněním vah a historie
      lastPick = weightedPick(candidates);
      setResult(lastPick);
      refreshDebug();
      
      isSpinning = false;
      el("btnPick").disabled = false;
      // Smazáno: el("btnAgain").disabled = false;
    }
  }, spinInterval);
}

function resetFilters() {
  Object.values(msInstances).forEach(instance => instance.reset());

  lastPick = null;
  setInitialMessage();
  updateActionButtons();
  refreshDebug();
}

function toggleFavorite() {
  if (!lastPick) return;

  const idx = state.favorites.indexOf(lastPick.id);
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
    saveState();
    setResult(lastPick, "Odebráno z oblíbených.");
  } else {
    state.favorites.push(lastPick.id);
    saveState();
    setResult(lastPick, "Přidáno do oblíbených.");
  }
}

function markCookedToday() {
  if (!lastPick) return;

  state.cooked[lastPick.id] = todayISO();
  saveState();
  setResult(lastPick, "Uloženo jako uvařeno dnes.");
}

function blockFor7Days() {
  if (!lastPick) return;

  state.blockedUntil[lastPick.id] = addDaysISO(todayISO(), 7);
  saveState();
  setResult(lastPick, `Skryto do ${state.blockedUntil[lastPick.id]}.`);
}

function exportState() {
  const payload = {
    exported_at: new Date().toISOString(),
    state
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "meal-picker-state.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importState(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result));
      if (!payload || !payload.state) {
        throw new Error("Neplatný import.");
      }

      state = {
        favorites: Array.isArray(payload.state.favorites) ? payload.state.favorites : [],
        cooked: payload.state.cooked && typeof payload.state.cooked === "object" ? payload.state.cooked : {},
        blockedUntil: payload.state.blockedUntil && typeof payload.state.blockedUntil === "object" ? payload.state.blockedUntil : {}
      };

      saveState();
      fillFilterOptions();

      if (lastPick) {
        setResult(lastPick, "Import proběhl úspěšně.");
      } else {
        setInitialMessage();
      }
    } catch (err) {
      alert("Import selhal: " + (err?.message ?? err));
    }
  };

  reader.readAsText(file);
}

function clearLocalData() {
  if (!confirm("Opravdu smazat všechna lokální data?")) return;

  localStorage.removeItem(LS_KEY);
  state = loadState();
  lastPick = null;
  setInitialMessage();
  updateActionButtons();
  fillFilterOptions();
  refreshDebug();
}

function refreshDebug() {
  el("debug").textContent = JSON.stringify(
    {
      state,
      lastPickId: lastPick?.id ?? null
    },
    null,
    2
  );
}

function wireUI() {
  el("btnPick").addEventListener("click", pickFood);
  el("btnReset").addEventListener("click", resetFilters);

  el("btnFav").addEventListener("click", toggleFavorite);
  el("btnCooked").addEventListener("click", markCookedToday);
  el("btnSkip").addEventListener("click", blockFor7Days);

  el("btnExport").addEventListener("click", exportState);
  el("btnClearLocal").addEventListener("click", clearLocalData);

  el("importFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importState(file);
    e.target.value = "";
  });
}

async function main() {
  try {
    wireUI();
    setInitialMessage();
    updateActionButtons();
    await loadDB();
    fillFilterOptions();
    refreshDebug();
  } catch (err) {
    console.error(err);
    const box = el("result");
    box.classList.add("muted");
    box.textContent = "Chyba: " + (err?.message ?? err);
  }
}

main();
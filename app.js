let db = null;
let lastPick = null;

const LS_KEY = "meal_picker_state_v3";

const el = (id) => document.getElementById(id);

function uniq(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "cs"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function splitPipeList(value) {
  if (!value) return [];
  return String(value)
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
      return {
        favorites: [],
        cooked: {},
        blockedUntil: {},
        customFoods: []
      };
    }

    const parsed = JSON.parse(raw);

    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      cooked: parsed.cooked && typeof parsed.cooked === "object" ? parsed.cooked : {},
      blockedUntil: parsed.blockedUntil && typeof parsed.blockedUntil === "object" ? parsed.blockedUntil : {},
      customFoods: Array.isArray(parsed.customFoods) ? parsed.customFoods : []
    };
  } catch {
    return {
      favorites: [],
      cooked: {},
      blockedUntil: {},
      customFoods: []
    };
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  refreshDebug();
  renderCustomFoods();
}

function getAllFoods() {
  return [...(db?.foods ?? []), ...state.customFoods];
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

function renderCheckboxGroup(containerId, values) {
  const container = el(containerId);
  container.innerHTML = values.map((v) => `
    <label class="check-item">
      <input type="checkbox" value="${escapeHtml(v)}">
      ${escapeHtml(v)}
    </label>
  `).join("");
}

function fillFilterOptions() {
  const foods = getAllFoods();

  const mealTypes = uniq(foods.flatMap((x) => asArray(x.meal_type)).filter(Boolean));
  const tags = uniq(foods.flatMap((x) => asArray(x.tags)).filter(Boolean));
  const methods = uniq(foods.flatMap((x) => asArray(x.methods)).filter(Boolean));
  const ingredients = uniq(foods.flatMap((x) => asArray(x.ingredients)).filter(Boolean));

  renderCheckboxGroup("mealTypeGroup", mealTypes);
  renderCheckboxGroup("tagGroup", tags);
  renderCheckboxGroup("methodGroup", methods);
  renderCheckboxGroup("ingredientGroup", ingredients);
}

function getCheckedValues(containerId) {
  return Array.from(el(containerId).querySelectorAll('input[type="checkbox"]:checked'))
    .map((x) => x.value);
}

function readFilters() {
  return {
    mealTypes: getCheckedValues("mealTypeGroup"),
    timeCategories: getCheckedValues("timeCategoryGroup"),
    tags: getCheckedValues("tagGroup"),
    methods: getCheckedValues("methodGroup"),
    ingredients: getCheckedValues("ingredientGroup")
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
  const box = el("result");
  box.classList.add("muted");
  box.textContent = "Klikni na „Vylosuj jídlo“.";
}

function setNoMatchMessage() {
  const box = el("result");
  box.classList.add("muted");
  box.textContent = "Nic nevyhovuje filtrům.";
}

function setResult(food, note = "") {
  const box = el("result");

  if (!food) {
    setNoMatchMessage();
    updateActionButtons();
    return;
  }

  box.classList.remove("muted");

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
  const foods = getAllFoods();
  const filters = readFilters();
  const candidates = applyFilters(foods, filters);

  if (candidates.length === 0) {
    lastPick = null;
    setNoMatchMessage();
    updateActionButtons();
    return;
  }

  lastPick = weightedPick(candidates);
  setResult(lastPick);
  refreshDebug();
}

function resetFilters() {
  document.querySelectorAll('.check-group input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });

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

function addCustomFood() {
  const name = el("customName").value.trim();
  if (!name) {
    alert("Vyplň název jídla.");
    return;
  }

  const baseId = slugify(name);
  let uniqueId = `custom-${baseId}`;
  let counter = 2;

  const allIds = new Set(getAllFoods().map((x) => x.id));
  while (allIds.has(uniqueId)) {
    uniqueId = `custom-${baseId}-${counter}`;
    counter++;
  }

  const customFood = {
    id: uniqueId,
    name,
    meal_type: splitPipeList(el("customMealType").value),
    time_category: el("customTimeCategory").value,
    methods: splitPipeList(el("customMethods").value),
    ingredients: splitPipeList(el("customIngredients").value),
    tags: splitPipeList(el("customTags").value),
    weight: Number(el("customWeight").value) || 1,
    isCustom: true
  };

  state.customFoods.push(customFood);
  saveState();
  fillFilterOptions();

  el("customName").value = "";
  el("customMealType").value = "";
  el("customTimeCategory").value = "0-30";
  el("customMethods").value = "";
  el("customIngredients").value = "";
  el("customTags").value = "";
  el("customWeight").value = "1";

  alert("Vlastní jídlo bylo přidáno.");
}

function deleteCustomFood(foodId) {
  state.customFoods = state.customFoods.filter((x) => x.id !== foodId);
  state.favorites = state.favorites.filter((id) => id !== foodId);
  delete state.cooked[foodId];
  delete state.blockedUntil[foodId];

  if (lastPick?.id === foodId) {
    lastPick = null;
    setInitialMessage();
  }

  saveState();
  fillFilterOptions();
}

function renderCustomFoods() {
  const box = el("customFoodsList");
  const foods = state.customFoods;

  if (!foods.length) {
    box.className = "custom-list muted";
    box.textContent = "Zatím žádná vlastní jídla.";
    return;
  }

  box.className = "custom-list";
  box.innerHTML = foods.map((food) => `
    <div class="custom-item">
      <div>
        <div class="custom-item-title">${escapeHtml(food.name)}</div>
        <div class="muted">
          ${escapeHtml(asArray(food.meal_type).join(", ") || "-")} •
          ${escapeHtml(food.time_category || "-")} •
          ${escapeHtml(asArray(food.methods).join(", ") || "-")}
        </div>
      </div>
      <button class="danger" data-delete-custom="${escapeHtml(food.id)}">Smazat</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-delete-custom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delete-custom");
      deleteCustomFood(id);
    });
  });
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
        blockedUntil: payload.state.blockedUntil && typeof payload.state.blockedUntil === "object" ? payload.state.blockedUntil : {},
        customFoods: Array.isArray(payload.state.customFoods) ? payload.state.customFoods : []
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
  renderCustomFoods();
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
  el("btnAgain").addEventListener("click", pickFood);
  el("btnReset").addEventListener("click", resetFilters);

  el("btnFav").addEventListener("click", toggleFavorite);
  el("btnCooked").addEventListener("click", markCookedToday);
  el("btnSkip").addEventListener("click", blockFor7Days);

  el("btnAddCustom").addEventListener("click", addCustomFood);

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
    renderCustomFoods();
    refreshDebug();
  } catch (err) {
    console.error(err);
    const box = el("result");
    box.classList.add("muted");
    box.textContent = "Chyba: " + (err?.message ?? err);
  }
}

main();

let db = null;
let lastPick = null;

const el = (id) => document.getElementById(id);

function uniq(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "cs"));
}

function weightedPick(items) {
  const weights = items.map(item => {
    const w = Number(item.weight);
    return Number.isFinite(w) && w > 0 ? w : 1;
  });

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

async function loadDB() {
  const res = await fetch("foods.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst foods.json");
  }

  const data = await res.json();
  if (!data || !Array.isArray(data.foods)) {
    throw new Error("Špatný formát foods.json");
  }

  db = data;
}

function fillFilterOptions() {
  const foods = db?.foods ?? [];

  const mealTypes = uniq(foods.flatMap(x => x.meal_type ?? []).filter(Boolean));
  const tags = uniq(foods.flatMap(x => x.tags ?? []).filter(Boolean));

  el("mealType").innerHTML =
    `<option value="">(libovolně)</option>` +
    mealTypes.map(x => `<option value="${x}">${x}</option>`).join("");

  el("tag").innerHTML =
    `<option value="">(libovolně)</option>` +
    tags.map(x => `<option value="${x}">${x}</option>`).join("");
}

function readFilters() {
  return {
    mealType: el("mealType").value,
    timeCategory: el("timeCategory").value,
    tag: el("tag").value,
  };
}

function applyFilters(foods, filters) {
  return foods.filter(food => {
    if (filters.mealType && !(food.meal_type ?? []).includes(filters.mealType)) {
      return false;
    }

    if (filters.timeCategory && food.time_category !== filters.timeCategory) {
      return false;
    }

    if (filters.tag && !(food.tags ?? []).includes(filters.tag)) {
      return false;
    }

    return true;
  });
}

function setResult(food) {
  const box = el("result");

  if (!food) {
    box.classList.add("muted");
    box.textContent = "Nic nevyhovuje filtrům.";
    return;
  }

  box.classList.remove("muted");

  const mealType = (food.meal_type ?? []).join(", ") || "-";
  const methods = (food.methods ?? []).join(", ") || "-";
  const ingredients = (food.ingredients ?? []).join(", ") || "-";
  const tags = (food.tags ?? []).join(", ") || "-";

  box.innerHTML = `
    <div><strong>${food.name}</strong></div>
    <div class="muted">Typ jídla: ${mealType}</div>
    <div class="muted">Čas: ${food.time_category || "-"}</div>
    <div class="muted">Příprava: ${methods}</div>
    <div class="muted">Suroviny: ${ingredients}</div>
    <div class="muted">Tagy: ${tags}</div>
  `;
}

function pickFood() {
  const foods = db?.foods ?? [];
  const filters = readFilters();
  const candidates = applyFilters(foods, filters);

  if (candidates.length === 0) {
    lastPick = null;
    setResult(null);
    return;
  }

  lastPick = weightedPick(candidates);
  setResult(lastPick);
}

function resetFilters() {
  el("mealType").value = "";
  el("timeCategory").value = "";
  el("tag").value = "";
  setResult(null);
}

function wireUI() {
  el("btnPick").addEventListener("click", pickFood);
  el("btnAgain").addEventListener("click", pickFood);
  el("btnReset").addEventListener("click", resetFilters);
}

async function main() {
  wireUI();

  try {
    await loadDB();
    fillFilterOptions();
  } catch (err) {
    el("result").textContent = "Chyba: " + (err?.message ?? err);
  }
}

main();
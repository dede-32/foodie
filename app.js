let db = null;
let lastPick = null;

const el = (id) => document.getElementById(id);

function uniq(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "cs"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function weightedPick(items) {
  const weights = items.map((item) => {
    const w = Number(item.weight);
    return Number.isFinite(w) && w > 0 ? w : 1;
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
  console.log("Databáze načtena:", db);
}

function fillFilterOptions() {
  const foods = db?.foods ?? [];

  const mealTypes = uniq(
    foods.flatMap((x) => asArray(x.meal_type)).filter(Boolean)
  );

  const tags = uniq(
    foods.flatMap((x) => asArray(x.tags)).filter(Boolean)
  );

  const mealTypeEl = el("mealType");
  const tagEl = el("tag");

  if (!mealTypeEl || !tagEl) {
    throw new Error("V index.html chybí element mealType nebo tag");
  }

  mealTypeEl.innerHTML =
    `<option value="">(libovolně)</option>` +
    mealTypes.map((x) => `<option value="${x}">${x}</option>`).join("");

  tagEl.innerHTML =
    `<option value="">(libovolně)</option>` +
    tags.map((x) => `<option value="${x}">${x}</option>`).join("");
}

function readFilters() {
  return {
    mealType: el("mealType")?.value ?? "",
    timeCategory: el("timeCategory")?.value ?? "",
    tag: el("tag")?.value ?? "",
  };
}

function applyFilters(foods, filters) {
  return foods.filter((food) => {
    const mealType = asArray(food.meal_type);
    const tags = asArray(food.tags);

    if (filters.mealType && !mealType.includes(filters.mealType)) {
      return false;
    }

    if (filters.timeCategory && food.time_category !== filters.timeCategory) {
      return false;
    }

    if (filters.tag && !tags.includes(filters.tag)) {
      return false;
    }

    return true;
  });
}

function setInitialMessage() {
  const box = el("result");
  if (!box) return;
  box.classList.add("muted");
  box.textContent = "Klikni na „Vylosuj jídlo“.";
}

function setNoMatchMessage() {
  const box = el("result");
  if (!box) return;
  box.classList.add("muted");
  box.textContent = "Nic nevyhovuje filtrům.";
}

function setResult(food) {
  const box = el("result");
  if (!box) return;

  if (!food) {
    setNoMatchMessage();
    return;
  }

  box.classList.remove("muted");

  const mealType = asArray(food.meal_type).join(", ") || "-";
  const methods = asArray(food.methods).join(", ") || "-";
  const ingredients = asArray(food.ingredients).join(", ") || "-";
  const tags = asArray(food.tags).join(", ") || "-";

  box.innerHTML = `
    <div><strong>${food.name ?? "-"}</strong></div>
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

  console.log("Filtry:", filters);
  console.log("Kandidáti:", candidates);

  if (candidates.length === 0) {
    lastPick = null;
    setNoMatchMessage();
    return;
  }

  lastPick = weightedPick(candidates);
  setResult(lastPick);
}

function resetFilters() {
  if (el("mealType")) el("mealType").value = "";
  if (el("timeCategory")) el("timeCategory").value = "";
  if (el("tag")) el("tag").value = "";
  lastPick = null;
  setInitialMessage();
}

function wireUI() {
  const btnPick = el("btnPick");
  const btnAgain = el("btnAgain");
  const btnReset = el("btnReset");

  if (!btnPick || !btnAgain || !btnReset) {
    throw new Error("V index.html chybí btnPick, btnAgain nebo btnReset");
  }

  btnPick.addEventListener("click", pickFood);
  btnAgain.addEventListener("click", pickFood);
  btnReset.addEventListener("click", resetFilters);
}

async function main() {
  try {
    wireUI();
    setInitialMessage();
    await loadDB();
    fillFilterOptions();
  } catch (err) {
    console.error(err);
    const box = el("result");
    if (box) {
      box.classList.add("muted");
      box.textContent = "Chyba: " + (err?.message ?? err);
    }
  }
}

main();

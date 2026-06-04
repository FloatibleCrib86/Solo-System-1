const isElectron = typeof window !== "undefined" && window.process && window.process.type === "renderer";
let ipcRenderer = null;

if (isElectron) {
    try {
        ipcRenderer = require("electron").ipcRenderer;
    } catch (error) {
        ipcRenderer = null;
    }
}

const STORAGE_PREFIX = "soloSystem_public_";
window.soloStorageFallback = window.soloStorageFallback || {};

function getStorage(key) {
    const storageKey = STORAGE_PREFIX + key;

    try {
        const value = localStorage.getItem(storageKey);
        return value ? JSON.parse(value) : null;
    } catch (error) {
        return window.soloStorageFallback[storageKey] || null;
    }
}

function setStorage(key, value) {
    const storageKey = STORAGE_PREFIX + key;

    try {
        localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
        window.soloStorageFallback[storageKey] = value;
    }
}

function setPlainStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        window.soloStorageFallback[key] = value;
    }
}

const tasksDiv = document.getElementById("tasks");
const timerDiv = document.getElementById("timer");
const focusDiv = document.getElementById("focus");

let modalMode = null;
let setupStep = 0;
let calorieViewMode = "daily";

const setupDays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
];

const PLAYER_NAME = "";
const IDEAL_WEIGHT_KG = "";
const HEIGHT_CM = "";
const CURRENT_WEIGHT_KG = "";

let setupData = getStorage("setupData") || {
    complete: false,
    name: "",
    height: "",
    currentWeight: "",
    goalWeight: "",
    bodyFat: "",
    targetBodyFat: "",
    weeklyPlan: {}
};

const defaultWeeklyPlan = {
    Monday: { focus: "Training", tasks: [] },
    Tuesday: { focus: "Training", tasks: [] },
    Wednesday: { focus: "Training", tasks: [] },
    Thursday: { focus: "Training", tasks: [] },
    Friday: { focus: "Training", tasks: [] },
    Saturday: { focus: "Training", tasks: [] },
    Sunday: { focus: "Rest", tasks: [] }
};

let weeklyPlan =
    getStorage("weeklyPlan") ||
    defaultWeeklyPlan;

setupData.weeklyPlan = weeklyPlan;

function saveWeeklyPlan() {
    setStorage("weeklyPlan", weeklyPlan);
}

function getTodayString() {
    return new Date().toLocaleDateString("en-AU");
}

function getDayName() {
    return new Date().toLocaleDateString("en-AU", { weekday: "long" });
}

function getGoalWeight() {
    return Number(setupData.goalWeight) || 0;
}

function getHeight() {
    return Number(setupData.height) || 0;
}

function getCurrentWeight() {
    const latest = data?.weightHistory?.at(-1);
    return latest ? Number(latest.weight) : Number(setupData.currentWeight) || 0;
}

function getCurrentBodyFat() {
    const latest = data?.fatHistory?.at(-1);
    return latest ? Number(latest.bodyFat) : Number(setupData.bodyFat) || 0;
}

function getEstimatedBodyFat() {
    return Number(setupData.bodyFat) || 22;
}

function getTargetBodyFat() {
    return Number(setupData.targetBodyFat) || 0;
}

function getEstimatedMaintenanceCalories() {
    return Math.round(getCurrentWeight() * 31);
}

function getDeficitFromBodyFat() {
    const bodyFat = getCurrentBodyFat();

    if (bodyFat > 20) return 700;
    if (bodyFat > 15) return 500;
    return 300;
}

function getCutCalories() {
    return getEstimatedMaintenanceCalories() - getDeficitFromBodyFat();
}

function getMaintainCalories() {
    return getEstimatedMaintenanceCalories();
}

function getGainCalories() {
    return getEstimatedMaintenanceCalories() + 300;
}

function getCaloriesLeftToday() {
    return getCutCalories() - getCaloriesEatenToday();
}

function getProteinTargetToday() {
    return Math.round(getCurrentWeight() * 2.2);
}

function getCarbsTargetToday() {
    return Math.round(getCutCalories() * 0.35 / 4);
}

function getFatTargetToday() {
    return Math.round(getCutCalories() * 0.25 / 9);
}

function getMacroTotalsForView() {
    return getMealsForCalorieView().reduce(
        (acc, meal) => ({
            protein: acc.protein + (meal.protein || 0),
            carbs:   acc.carbs   + (meal.carbs   || 0),
            fat:     acc.fat     + (meal.fat     || 0)
        }),
        { protein: 0, carbs: 0, fat: 0 }
    );
}

function isCalorieLimitReached() {
    return getCaloriesLeftToday() <= 0;
}

function closeCalorieDoneOverlay() {
    document.getElementById("calorieDoneOverlay").style.display = "none";
}

function loadData() {
    const saved = getStorage("questData") || {};
    const today = getTodayString();

    if (saved.date !== today) {
        return {
            date: today,
            completed: {},
            tempTasks: [],
            meals: [],
            weightHistory:
                saved.weightHistory ||
                [{ date: today, weight: Number(setupData.currentWeight) || 0 }],
            fatHistory:
                saved.fatHistory ||
                [{ date: today, bodyFat: Number(setupData.bodyFat) || 0 }]
        };
    }

    return {
        date: saved.date,
        completed: saved.completed || {},
        tempTasks: saved.tempTasks || [],
        meals: saved.meals || [],
        weightHistory:
            saved.weightHistory ||
            [{ date: today, weight: Number(setupData.currentWeight) || 0 }],
        fatHistory:
            saved.fatHistory ||
            [{ date: today, bodyFat: Number(setupData.bodyFat) || 0 }]
    };
}

let data = loadData();
let frequentMeals = getStorage("frequentMeals") || [];

let rehabData = getStorage("rehabData") || {
    active: false,
    bodyPart: "",
    pain: 0,
    recoveryUntil: "",
    tasks: [],
    needsReview: false
};

function saveRehabData() {
    setStorage("rehabData", rehabData);
}

function saveData() {
    setStorage("questData", data);
}

function saveFrequentMeals() {
    setStorage("frequentMeals", frequentMeals);
}

function autoResizeWindow() {
    requestAnimationFrame(() => {
        const panel = document.querySelector(".panel");
        if (!panel) return;

        const height = panel.scrollHeight + 25;
        if (ipcRenderer) {
            ipcRenderer.send("resize-window", height);
        }
    });
}

/* ======================
   SETUP
====================== */
function startSetupIfNeeded() {
    if (!setupData.complete) {
        document.getElementById("setupOverlay").style.display = "flex";
        document.getElementById("tasksPage").style.display = "none";
        document.getElementById("statsPage").style.display = "none";
        document.getElementById("caloriePage").style.display = "none";
        renderSetupStep();
    } else {
        document.getElementById("setupOverlay").style.display = "none";
        document.getElementById("tasksPage").style.display = "flex";
        document.getElementById("statsPage").style.display = "none";
        document.getElementById("caloriePage").style.display = "none";
    }

    autoResizeWindow();
}

function renderSetupStep() {
    const content = document.getElementById("setupContent");
    const subtitle = document.getElementById("setupSubtitle");
    const backBtn = document.getElementById("setupBackBtn");
    content.innerHTML = "";
    backBtn.style.display = setupStep === 0 ? "none" : "block";

    if (setupStep === 0) {
        subtitle.innerText = "Enter player info";
        content.innerHTML = `
            <input class="setup-input" id="setupName" placeholder="Name (Optional)" value="${setupData.name === 'user' ? '' : (setupData.name || "")}">
            <input class="setup-input" id="setupHeight" type="number" placeholder="Height in cm (Optional)" value="${setupData.height || ""}">
            <input class="setup-input" id="setupCurrentWeight" type="number" placeholder="Current weight in kg (Optional)" value="${setupData.currentWeight || ""}">
            <input class="setup-input" id="setupGoalWeight" type="number" placeholder="Goal weight in kg (Optional)" value="${setupData.goalWeight || ""}">
            <input class="setup-input" id="setupBodyFat" type="number" placeholder="Body Fat % (Optional)" value="${setupData.bodyFat || ""}">
            <input class="setup-input" id="setupTargetBodyFat" type="number" placeholder="Target Body Fat % (Optional)" value="${setupData.targetBodyFat || ""}">
        `;
        return;
    }
    const day = setupDays[setupStep - 1];
    const dayPlan = setupData.weeklyPlan[day] || {
        focus: "Training",
        tasks: []
    };

    subtitle.innerText = `Set up ${day}`;

    content.innerHTML = `
        <input
            class="setup-input"
            id="setupFocus"
            placeholder="Name this day's focus"
            value="${dayPlan.focus || "Training"}"
        >

        <div id="setupTaskList"></div>

        <button class="page-btn" onclick="addSetupTaskInput()">+ Add Task</button>
    `;

    const list = document.getElementById("setupTaskList");
    const tasks = dayPlan.tasks.length ? dayPlan.tasks : [];

    tasks.forEach(task => {
        const t = normaliseTask(task);
        const row = document.createElement("div");
        row.className = "setup-task setup-exercise-row";

        row.innerHTML = `
            <input class="setup-input setup-task-name" value="${escapeHtml(t.name === "Exercise" ? "" : t.name)}" placeholder="Exercise name">
            <input class="setup-input setup-task-reps" type="number" min="0" value="${escapeHtml(t.reps)}" placeholder="Reps">
            <input class="setup-input setup-task-sets" type="number" min="0" value="${escapeHtml(t.sets)}" placeholder="Sets">
            <input class="setup-input setup-task-weight" value="${escapeHtml(t.weight)}" placeholder="Weight optional">
            <button onclick="this.parentElement.remove()">×</button>
        `;

        list.appendChild(row);
    });

    autoResizeWindow();
}

function saveCurrentSetupStep() {
    if (setupStep === 0) {
        setupData.name = document.getElementById("setupName").value.trim() || "user";
        setPlainStorage("playerName", setupData.name);
        setupData.height = document.getElementById("setupHeight").value.trim();
        setupData.currentWeight = document.getElementById("setupCurrentWeight").value.trim();
        setupData.goalWeight = document.getElementById("setupGoalWeight").value.trim();
        setupData.bodyFat = document.getElementById("setupBodyFat").value.trim();
        setupData.targetBodyFat = document.getElementById("setupTargetBodyFat").value.trim();
        return;
    }

    const day = setupDays[setupStep - 1];

    const focus =
        document.getElementById("setupFocus").value.trim() || "Training";

    const taskRows = [...document.querySelectorAll(".setup-task")];

    const tasks = taskRows
        .map(row => createExerciseTask(
            row.querySelector(".setup-task-name")?.value.trim() || "",
            row.querySelector(".setup-task-reps")?.value.trim() || "",
            row.querySelector(".setup-task-sets")?.value.trim() || "",
            row.querySelector(".setup-task-weight")?.value.trim() || ""
        ))
        .filter(task => task.name);

    setupData.weeklyPlan[day] = {
        focus,
        tasks
    };
}

function setupNext(event) {
    if (event?.preventDefault) event.preventDefault();

    saveCurrentSetupStep();

    if (setupStep > 0) {
        const day = setupDays[setupStep - 1];

        if (!setupData.weeklyPlan[day].focus) {
            alert(`Name the focus for ${day}.`);
            return;
        }
    }

    setupStep++;

    if (setupStep > setupDays.length) {
        finishSetup();
        return;
    }

    setStorage("setupData", setupData);
    document.getElementById("setupOverlay").style.display = "flex";
    document.getElementById("tasksPage").style.display = "none";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    renderSetupStep();
}

function setupBack() {
    saveCurrentSetupStep();
    setupStep--;
    renderSetupStep();
}

function addSetupTaskInput() {
    const list = document.getElementById("setupTaskList");

    const row = document.createElement("div");
    row.className = "setup-task setup-exercise-row";

    row.innerHTML = `
        <input class="setup-input setup-task-name" placeholder="Exercise name">
        <input class="setup-input setup-task-reps" type="number" min="0" placeholder="Reps">
        <input class="setup-input setup-task-sets" type="number" min="0" placeholder="Sets">
        <input class="setup-input setup-task-weight" placeholder="Weight optional">
        <button onclick="this.parentElement.remove()">×</button>
    `;

    list.appendChild(row);
    autoResizeWindow();
}

function finishSetup() {
    console.log("Finishing setup...");
    
    setupData.complete = true;
    setStorage("setupData", setupData);
    setStorage("weeklyPlan", setupData.weeklyPlan);

    weeklyPlan = setupData.weeklyPlan;

    data = {
        date: getTodayString(),
        completed: {},
        tempTasks: [],
        meals: [],
        weightHistory: [
            {
                date: getTodayString(),
                weight: Number(setupData.currentWeight) || 0
            }
        ],
        fatHistory: [
            {
                date: getTodayString(),
                bodyFat: Number(setupData.bodyFat) || 0
            }
        ]
    };

    saveData();
    
    console.log("Setup complete, saving data:", { setupData, data });

    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "flex";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";

    render();
    renderStatsPage();
    renderCaloriePage();
    autoResizeWindow();
}

/* ======================
   DAILY RESET
====================== */
function checkNewDay() {
    const today = getTodayString();

    if (data.date !== today) {
        data = loadData();

        checkRehabStatus();

        saveData();
        render();
        renderStatsPage();
        renderCaloriePage();
    }
}

/* ======================
   TASKS
====================== */
function createExerciseTask(name = "", reps = "", sets = "", weight = "") {
    return {
        id: makeId(),
        name,
        reps,
        sets,
        weight
    };
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normaliseTask(task) {
    if (typeof task === "string") {
        return {
            id: `legacy-${task}`,
            name: task,
            reps: "",
            sets: "",
            weight: ""
        };
    }

    return {
        id: task.id || makeId(),
        name: task.name || task.exercise || task.title || "Exercise",
        reps: task.reps || "",
        sets: task.sets || "",
        weight: task.weight || ""
    };
}

function getTaskKey(task) {
    return normaliseTask(task).id;
}

function getTaskLabel(task) {
    const t = normaliseTask(task);
    const parts = [t.name];
    if (t.sets) parts.push(`${t.sets} sets`);
    if (t.reps) parts.push(`${t.reps} reps`);
    if (t.weight) parts.push(t.weight);
    return parts.join(" • ");
}

function getAllTasks() {
    const day = getDayName();

    if (!weeklyPlan[day]) {
        return [];
    }

    return [...weeklyPlan[day].tasks, ...data.tempTasks];
}

function render() {
    const day = getDayName();

    if (!weeklyPlan[day]) {
        focusDiv.innerHTML = `<strong>${day}</strong><br>Focus: No plan found`;
        tasksDiv.innerHTML = "";
        autoResizeWindow();
        return;
    }

    focusDiv.innerHTML = `
        <strong>${day}</strong><br>
        Focus: ${weeklyPlan[day].focus}
    `;

    tasksDiv.innerHTML = "";

    weeklyPlan[day].tasks.forEach((task, i) => renderTaskItem(task, false, i, day));
    data.tempTasks.forEach((task, i) => renderTaskItem(task, true, i, day));

    saveData();
    checkCompleted();
    autoResizeWindow();
}

function updateTaskField(isTemp, index, field, value, day = getDayName()) {
    const list = isTemp ? data.tempTasks : weeklyPlan[day].tasks;
    const original = list[index];
    const oldKey = getTaskKey(original);
    const updated = normaliseTask(original);

    updated[field] = value.trim();
    list[index] = updated;

    const newKey = getTaskKey(updated);
    if (oldKey !== newKey && data.completed[oldKey] !== undefined) {
        data.completed[newKey] = data.completed[oldKey];
        delete data.completed[oldKey];
    }

    if (isTemp) saveData();
    else saveWeeklyPlan();
}

function renderTaskItem(task, isTemp, index = null, day = getDayName()) {
    const t = normaliseTask(task);
    const key = getTaskKey(t);

    const div = document.createElement("div");
    div.className = "task";

    const row = document.createElement("div");
    row.className = "task-row";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!data.completed[key];
    checkbox.onchange = () => toggleTask(task);

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(getTaskLabel(t)));
    row.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.innerText = "Edit";
    editBtn.onclick = () => isTemp ? editTempTask(index) : editWeeklyTask(day, index);
    actions.appendChild(editBtn);

    if (isTemp) {
        const removeBtn = document.createElement("button");
        removeBtn.innerText = "Remove";
        removeBtn.onclick = () => removeTempTask(index);
        actions.appendChild(removeBtn);
    }

    row.appendChild(actions);
    div.appendChild(row);
    tasksDiv.appendChild(div);
}

function toggleTask(task) {
    const key = getTaskKey(task);
    data.completed[key] = !data.completed[key];
    saveData();
    render();
}

function editTempTask(index) {
    modalMode = "editQuest";
    window.editingTaskIndex = index;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Edit Temporary Quest";
    fillExerciseModal(normaliseTask(data.tempTasks[index]));
    openModal("modalInput");
}

function removeTempTask(index) {
    const task = data.tempTasks[index];
    data.tempTasks.splice(index, 1);
    delete data.completed[getTaskKey(task)];
    saveData();
    render();
}

function allTasksComplete() {
    const tasks = getAllTasks();
    return tasks.length && tasks.every(t => data.completed[getTaskKey(t)]);
}

function checkCompleted() {
    const overlay = document.getElementById("completedOverlay");
    overlay.style.display = allTasksComplete() ? "flex" : "none";
}

/* ======================
   CALORIES
====================== */
function getTodayMeals() {
    return data.meals.filter(meal => meal.date === getTodayString());
}

function getWeekRange() {
    const now = new Date();
    const start = new Date(now);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
}

function parseAuDate(dateString) {
    const [day, month, year] = String(dateString).split("/").map(Number);
    return new Date(year, month - 1, day);
}

function getThisWeekMeals() {
    const { start, end } = getWeekRange();
    return data.meals.filter(meal => {
        const date = parseAuDate(meal.date);
        return date >= start && date <= end;
    });
}

function getMealsForCalorieView() {
    return calorieViewMode === "weekly" ? getThisWeekMeals() : getTodayMeals();
}

function getCaloriesEatenToday() {
    return getTodayMeals().reduce((total, meal) => total + meal.calories, 0);
}

function getCaloriesEatenForView() {
    return getMealsForCalorieView().reduce((total, meal) => total + meal.calories, 0);
}

function getCalorieTargetForView() {
    return calorieViewMode === "weekly" ? getCutCalories() * 7 : getCutCalories();
}

function getCaloriesLeftForView() {
    return getCalorieTargetForView() - getCaloriesEatenForView();
}


function getMealQuantity(meal) {
    const quantity = Number(meal?.quantity || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getMealBaseCalories(meal) {
    const quantity = getMealQuantity(meal);
    const baseCalories = Number(meal?.baseCalories || 0);
    if (Number.isFinite(baseCalories) && baseCalories > 0) return baseCalories;
    const totalCalories = Number(meal?.calories || 0);
    return quantity > 0 ? Math.round(totalCalories / quantity) : totalCalories;
}

function getMealDisplayName(meal) {
    const quantity = getMealQuantity(meal);
    return quantity > 1 ? `${meal.name} × ${quantity}` : meal.name;
}

function setCalorieView(mode) {
    calorieViewMode = mode;
    renderCaloriePage();
}

function renderCaloriePage() {
    document.getElementById("idealWeightText").innerText = `${getGoalWeight()} kg`;
    document.getElementById("calorieHeightText").innerText = `${getHeight()} cm`;

    document.getElementById("cutCaloriesText").innerText = `${getCutCalories()} kcal`;
    document.getElementById("maintainCaloriesText").innerText = `${getMaintainCalories()} kcal`;
    document.getElementById("gainCaloriesText").innerText = `${getGainCalories()} kcal`;

    const calorieBodyFatText = document.getElementById("calorieBodyFatText");
    if (calorieBodyFatText) {
        calorieBodyFatText.innerText = `${getCurrentBodyFat()}%`;
    }

    const calorieTargetBodyFatText = document.getElementById("calorieTargetBodyFatText");
    if (calorieTargetBodyFatText) {
        calorieTargetBodyFatText.innerText = `${getTargetBodyFat()}%`;
    }

    const mealList = document.getElementById("mealList");
    mealList.innerHTML = "";

    const viewLabel = document.getElementById("calorieViewLabel");
    if (viewLabel) {
        const { start, end } = getWeekRange();
        viewLabel.innerText = calorieViewMode === "weekly"
            ? `This week: ${start.toLocaleDateString("en-AU")} – ${end.toLocaleDateString("en-AU")}`
            : `Today: ${getTodayString()}`;
    }

    document.querySelectorAll(".calorie-toggle-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === calorieViewMode);
    });

    getMealsForCalorieView().forEach((meal) => {
        const actualIndex = findMealActualIndex(meal);
        const div = document.createElement("div");
        div.className = "meal-item";

        div.innerHTML = `
            <div class="task-row">
                <span><strong>${meal.date} ${meal.time}</strong> — ${getMealDisplayName(meal)}: ${meal.calories} kcal</span>
                <div class="task-actions">
                    <button onclick="editMealByActualIndex(${actualIndex})">Edit</button>
                    <button onclick="removeMealByActualIndex(${actualIndex})">Remove</button>
                </div>
            </div>
        `;

        mealList.appendChild(div);
    });

    const caloriesLeft = getCaloriesLeftForView();

    document.getElementById("caloriesLeftText").innerText = `${caloriesLeft} kcal`;
    const eatenText = document.getElementById("caloriesEatenText");
    if (eatenText) eatenText.innerText = `${getCaloriesEatenForView()} / ${getCalorieTargetForView()} kcal`;

    const macros = getMacroTotalsForView();
    const proteinEl = document.getElementById("proteinText");
    const carbsEl   = document.getElementById("carbsText");
    const fatEl     = document.getElementById("fatText");
    if (proteinEl) proteinEl.innerText = `${macros.protein} g / ${getProteinTargetToday()} g`;
    if (carbsEl)   carbsEl.innerText   = `${macros.carbs} g / ${getCarbsTargetToday()} g`;
    if (fatEl)     fatEl.innerText     = `${macros.fat} g / ${getFatTargetToday()} g`;

    const calorieBox = document.querySelector(".calorie-left-box");
    const addMealBtn = document.getElementById("addMealBtn");
    const frequentMealBtn = document.getElementById("frequentMealBtn");
    const doneOverlay = document.getElementById("calorieDoneOverlay");

    if (calorieViewMode === "daily" && caloriesLeft <= 0) {
        calorieBox.classList.add("calorie-over");
        addMealBtn.disabled = true;
        addMealBtn.classList.add("locked-btn");
        if (frequentMealBtn) {
            frequentMealBtn.disabled = true;
            frequentMealBtn.classList.add("locked-btn");
        }

        if (doneOverlay) {
            doneOverlay.style.display = "flex";
        }
    } else {
        calorieBox.classList.remove("calorie-over");
        addMealBtn.disabled = false;
        addMealBtn.classList.remove("locked-btn");
        if (frequentMealBtn) {
            frequentMealBtn.disabled = false;
            frequentMealBtn.classList.remove("locked-btn");
        }

        if (doneOverlay) {
            doneOverlay.style.display = "none";
        }
    }

    autoResizeWindow();
}

function removeMeal(index) {
    const mealToRemove = getTodayMeals()[index];
    removeMealByActualIndex(findMealActualIndex(mealToRemove));
}

function removeMealByActualIndex(actualIndex) {
    if (actualIndex !== -1) {
        data.meals.splice(actualIndex, 1);
    }

    saveData();
    renderCaloriePage();
}

function getCurrentTimeInputValue() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normaliseMealTimeForInput(time) {
    if (!time) return getCurrentTimeInputValue();
    const match = String(time).match(/(\d{1,2}):(\d{2})/);
    if (!match) return getCurrentTimeInputValue();
    return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function formatTimeForDisplay(timeValue) {
    if (!timeValue) return getCurrentTimeInputValue();
    const [hour, minute] = timeValue.split(":");
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function makeId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findMealActualIndex(meal) {
    if (!meal) return -1;

    if (meal.id) {
        return data.meals.findIndex(m => m.id === meal.id);
    }

    return data.meals.findIndex(
        m =>
            m.date === meal.date &&
            m.time === meal.time &&
            m.name === meal.name &&
            m.calories === meal.calories
    );
}

function editMeal(index) {
    const meal = getTodayMeals()[index];
    editMealByActualIndex(findMealActualIndex(meal));
}

function editMealByActualIndex(actualIndex) {
    modalMode = "editMeal";
    window.editingMealIndex = actualIndex;

    const meal = data.meals[actualIndex];

    if (!meal) return;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Edit Meal";

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Enter meal name";
    input.value = meal.name;

    const calorieInput = document.getElementById("modalInputCalories");
    calorieInput.style.display = "block";
    calorieInput.type = "number";
    calorieInput.min = "1";
    calorieInput.placeholder = "Enter calorie count";
    calorieInput.value = getMealBaseCalories(meal);

    const quantityInput = document.getElementById("modalInputQuantity");
    if (quantityInput) {
        quantityInput.style.display = "block";
        quantityInput.type = "number";
        quantityInput.min = "0.25";
        quantityInput.step = "0.25";
        quantityInput.placeholder = "Multiplier / quantity";
        quantityInput.value = getMealQuantity(meal);
    }

    const timeInput = document.getElementById("modalInputTime");
    if (timeInput) {
        timeInput.style.display = "block";
        timeInput.type = "time";
        timeInput.value = normaliseMealTimeForInput(meal.time);
    }

    const macroFields = [
        { id: "modalProtein", key: "protein", placeholder: "Protein (g)" },
        { id: "modalCarbs",   key: "carbs",   placeholder: "Carbs (g)"   },
        { id: "modalFat",     key: "fat",     placeholder: "Fat (g)"     }
    ];
    macroFields.forEach(({ id, key, placeholder }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "block";
        el.placeholder = placeholder;
        el.value = meal[key] != null ? meal[key] : "";
    });

    openModal("modalInput");
}

function openMealModal() {
    if (isCalorieLimitReached()) return;
    
    modalMode = "meal";

    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Add Meal";

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Enter meal name";

    const calorieInput = document.getElementById("modalInputCalories");
    calorieInput.style.display = "block";
    calorieInput.type = "number";
    calorieInput.min = "1";
    calorieInput.placeholder = "Calories per serve";

    const quantityInput = document.getElementById("modalInputQuantity");
    if (quantityInput) {
        quantityInput.style.display = "block";
        quantityInput.type = "number";
        quantityInput.min = "0.25";
        quantityInput.step = "0.25";
        quantityInput.placeholder = "Multiplier / quantity";
        quantityInput.value = "1";
    }

    const timeInput = document.getElementById("modalInputTime");
    if (timeInput) {
        timeInput.style.display = "block";
        timeInput.type = "time";
        timeInput.value = getCurrentTimeInputValue();
    }

    ["modalProtein", "modalCarbs", "modalFat"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "block";
        el.value = "";
    });

    openModal("modalInput");
}


function goToFrequentMeals() {
    hideAllPages();
    const frequentPage = document.getElementById("frequentMealPage");
    if (frequentPage) {
        frequentPage.style.display = "flex";
        renderFrequentMealsPage();
    }
    autoResizeWindow();
}

function renderFrequentMealsPage() {
    const list = document.getElementById("frequentMealList");
    if (!list) return;

    list.innerHTML = "";

    if (!frequentMeals.length) {
        list.innerHTML = `<div class="meal-item">No frequent meals yet. Add one below.</div>`;
        return;
    }

    frequentMeals.forEach((meal, index) => {
        const div = document.createElement("div");
        div.className = "meal-item";
        div.innerHTML = `
            <div class="frequent-meal-row">
                <div class="frequent-meal-info">
                    <strong>${escapeHtml(meal.name)}</strong><br>
                    ${Number(meal.calories || 0)} kcal each
                </div>
                <input class="frequent-qty-input" id="frequentQty${index}" type="number" min="0.25" step="0.25" value="1" aria-label="Multiplier">
            </div>
            <div class="task-actions frequent-actions">
                <button onclick="logFrequentMeal(${index})">Add</button>
                <button onclick="editFrequentMeal(${index})">Edit</button>
                <button onclick="deleteFrequentMeal(${index})">Remove</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function openFrequentMealModal() {
    modalMode = "frequentMeal";
    window.editingFrequentMealIndex = null;
    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Add Frequent Meal";

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Meal name";

    const calorieInput = document.getElementById("modalInputCalories");
    calorieInput.style.display = "block";
    calorieInput.type = "number";
    calorieInput.min = "1";
    calorieInput.placeholder = "Calories per serve";

    ["modalProtein", "modalCarbs", "modalFat"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "block";
        el.value = "";
    });

    openModal("modalInput");
}

function editFrequentMeal(index) {
    const meal = frequentMeals[index];
    if (!meal) return;

    modalMode = "editFrequentMeal";
    window.editingFrequentMealIndex = index;
    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Edit Frequent Meal";

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Meal name";
    input.value = meal.name;

    const calorieInput = document.getElementById("modalInputCalories");
    calorieInput.style.display = "block";
    calorieInput.type = "number";
    calorieInput.min = "1";
    calorieInput.placeholder = "Calories per serve";
    calorieInput.value = meal.calories;

    const macroFields = [
        { id: "modalProtein", key: "protein", placeholder: "Protein (g)" },
        { id: "modalCarbs",   key: "carbs",   placeholder: "Carbs (g)"   },
        { id: "modalFat",     key: "fat",     placeholder: "Fat (g)"     }
    ];
    macroFields.forEach(({ id, key, placeholder }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = "block";
        el.placeholder = placeholder;
        el.value = meal[key] != null ? meal[key] : "";
    });

    openModal("modalInput");
}

function readFrequentQuantity(index) {
    const input = document.getElementById(`frequentQty${index}`);
    const quantity = Number(input?.value || 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function logFrequentMeal(index) {
    const meal = frequentMeals[index];
    if (!meal) return;

    const quantity = readFrequentQuantity(index);
    const baseCalories = Number(meal.calories || 0);

    data.meals.push({
        id: makeId(),
        date: getTodayString(),
        time: formatTimeForDisplay(getCurrentTimeInputValue()),
        name: meal.name,
        baseCalories,
        quantity,
        calories: Math.round(baseCalories * quantity),
        baseProtein: meal.protein || 0,
        baseCarbs:   meal.carbs   || 0,
        baseFat:     meal.fat     || 0,
        protein: Math.round((meal.protein || 0) * quantity),
        carbs:   Math.round((meal.carbs   || 0) * quantity),
        fat:     Math.round((meal.fat     || 0) * quantity)
    });

    saveData();
    renderFrequentMealsPage();
    renderCaloriePage();
}

function deleteFrequentMeal(index) {
    if (!confirm("Remove this frequent meal?")) return;
    frequentMeals.splice(index, 1);
    saveFrequentMeals();
    renderFrequentMealsPage();
}

function goToCalories() {
    hideAllPages();
    document.getElementById("caloriePage").style.display = "flex";
    renderCaloriePage();
}

/* ======================
   MODAL
====================== */
function resetModalInputs() {
    const input = document.getElementById("modalInput");
    const calorieInput = document.getElementById("modalInputCalories");
    const timeInput = document.getElementById("modalInputTime");
    const repsInput = document.getElementById("modalInputReps");
    const setsInput = document.getElementById("modalInputSets");
    const weightInput = document.getElementById("modalInputWeight");
    const quantityInput = document.getElementById("modalInputQuantity");
    const error = document.getElementById("modalError");

    input.value = "";
    input.type = "text";
    input.placeholder = "";
    input.style.display = "block";
    input.removeAttribute("step");
    input.removeAttribute("min");

    calorieInput.value = "";
    calorieInput.type = "number";
    calorieInput.placeholder = "";
    calorieInput.style.display = "none";
    calorieInput.removeAttribute("step");
    calorieInput.removeAttribute("min");

    if (timeInput) {
        timeInput.value = "";
        timeInput.type = "time";
        timeInput.placeholder = "";
        timeInput.style.display = "none";
    }

    [repsInput, setsInput, weightInput, quantityInput].forEach(extraInput => {
        if (!extraInput) return;
        extraInput.value = "";
        extraInput.type = "text";
        extraInput.placeholder = "";
        extraInput.style.display = "none";
        extraInput.removeAttribute("min");
    });

    ["modalProtein", "modalCarbs", "modalFat"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = "";
        el.style.display = "none";
    });

    error.innerText = "";
}

function openModal(focusInputId = "modalInput") {
    document.getElementById("inputModal").style.display = "flex";

    setTimeout(() => {
        const input = document.getElementById(focusInputId);
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);

    autoResizeWindow();
}

function closeModal() {
    document.getElementById("inputModal").style.display = "none";
    modalMode = null;
    resetModalInputs();
}

function showModalError(message, focusInputId = "modalInput") {
    const error = document.getElementById("modalError");
    error.innerText = message;

    setTimeout(() => {
        const input = document.getElementById(focusInputId);
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function openQuestModal() {
    if (allTasksComplete()) return;

    modalMode = "quest";
    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Add Temporary Exercise";
    fillExerciseModal();
    openModal("modalInput");
}

function openWeightModal() {
    modalMode = "weight";
    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Add Weight";

    const input = document.getElementById("modalInput");
    input.type = "number";
    input.step = "0.1";
    input.min = "1";
    input.placeholder = "Enter weight in kg";

    openModal("modalInput");
}

function openBodyFatModal() {
    modalMode = "bodyFat";
    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Add Body Fat %";

    const input = document.getElementById("modalInput");
    input.type = "number";
    input.step = "0.1";
    input.min = "1";
    input.placeholder = "Enter body fat percentage";

    openModal("modalInput");
}

function openWeeklyTaskModal(day) {
    modalMode = "weeklyTask";
    window.selectedDay = day;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = `Add Exercise To ${day}`;
    fillExerciseModal();
    openModal("modalInput");
}

function editWeeklyTask(day, index) {
    modalMode = "editWeeklyTask";
    window.selectedDay = day;
    window.editingWeeklyTaskIndex = index;

    resetModalInputs();
    document.getElementById("modalTitle").innerText = `Edit ${day} Exercise`;
    fillExerciseModal(normaliseTask(weeklyPlan[day].tasks[index]));
    openModal("modalInput");
}

function editDayFocus(day) {
    modalMode = "editFocus";
    window.selectedDay = day;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = `Edit ${day} Focus`;

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Enter focus";
    input.value = weeklyPlan[day].focus;

    openModal("modalInput");
}

function fillExerciseModal(task = {}) {
    const t = normaliseTask(task.name ? task : "");

    const input = document.getElementById("modalInput");
    input.type = "text";
    input.placeholder = "Exercise name";
    input.value = t.name === "Exercise" ? "" : t.name;

    const repsInput = document.getElementById("modalInputReps");
    const setsInput = document.getElementById("modalInputSets");
    const weightInput = document.getElementById("modalInputWeight");

    if (repsInput) {
        repsInput.style.display = "block";
        repsInput.type = "number";
        repsInput.min = "0";
        repsInput.placeholder = "Reps";
        repsInput.value = t.reps || "";
    }

    if (setsInput) {
        setsInput.style.display = "block";
        setsInput.type = "number";
        setsInput.min = "0";
        setsInput.placeholder = "Sets";
        setsInput.value = t.sets || "";
    }

    if (weightInput) {
        weightInput.style.display = "block";
        weightInput.type = "text";
        weightInput.placeholder = "Weight optional, e.g. 5kg dumbbells";
        weightInput.value = t.weight || "";
    }
}

function readExerciseModal() {
    return {
        id: makeId(),
        name: document.getElementById("modalInput").value.trim(),
        reps: document.getElementById("modalInputReps")?.value.trim() || "",
        sets: document.getElementById("modalInputSets")?.value.trim() || "",
        weight: document.getElementById("modalInputWeight")?.value.trim() || ""
    };
}

function readMacroInputs() {
    const protein = parseFloat(document.getElementById("modalProtein")?.value) || 0;
    const carbs   = parseFloat(document.getElementById("modalCarbs")?.value)   || 0;
    const fat     = parseFloat(document.getElementById("modalFat")?.value)     || 0;
    return { protein, carbs, fat };
}

function submitModal() {
    const input = document.getElementById("modalInput").value.trim();

    if (!input && !["meal", "editMeal", "quest", "editQuest", "weeklyTask"].includes(modalMode)) {
        showModalError("Input cannot be empty.", "modalInput");
        return;
    }

    if (modalMode === "quest") {
        const task = readExerciseModal();
        if (!task.name) {
            showModalError("Enter an exercise name.", "modalInput");
            return;
        }
        data.tempTasks.push(task);
    }

    if (modalMode === "editQuest") {
        const i = window.editingTaskIndex;
        const old = data.tempTasks[i];
        const task = readExerciseModal();
        task.id = getTaskKey(old);
        data.tempTasks[i] = task;

        if (data.completed[getTaskKey(old)]) {
            data.completed[getTaskKey(task)] = true;
        }

        delete data.completed[getTaskKey(old)];
    }

    if (modalMode === "weight") {
        const weight = Number(input);

        if (!Number.isFinite(weight) || weight <= 0) {
            showModalError("Enter a valid weight.", "modalInput");
            return;
        }

        data.weightHistory.push({
            date: getTodayString(),
            weight
        });

        saveData();
        closeModal();
        renderStatsPage();
        return;
    }

    if (modalMode === "editWeight") {
        const weight = Number(input);

        if (!Number.isFinite(weight) || weight <= 0) {
            showModalError("Enter a valid weight.", "modalInput");
            return;
        }

        data.weightHistory[window.editingWeightIndex].weight = weight;

        saveData();
        closeModal();
        renderStatsPage();
        return;
    }

    if (modalMode === "weeklyTask") {
        const task = readExerciseModal();
        if (!task.name) {
            showModalError("Enter an exercise name.", "modalInput");
            return;
        }
        weeklyPlan[window.selectedDay].tasks.push(task);
        saveWeeklyPlan();
        saveData();
        closeModal();
        openDayEditor(window.selectedDay);
        render();
        return;
    }

    if (modalMode === "editWeeklyTask") {
        const day = window.selectedDay;
        const i = window.editingWeeklyTaskIndex;
        const old = weeklyPlan[day].tasks[i];
        const task = readExerciseModal();

        if (!task.name) {
            showModalError("Enter an exercise name.", "modalInput");
            return;
        }

        task.id = getTaskKey(old);
        weeklyPlan[day].tasks[i] = task;

        if (data.completed[getTaskKey(old)]) {
            data.completed[getTaskKey(task)] = true;
        }

        delete data.completed[getTaskKey(old)];
        saveWeeklyPlan();
        saveData();
        closeModal();
        renderStatsPage();
        render();
        return;
    }

    if (modalMode === "editFocus") {
        weeklyPlan[window.selectedDay].focus = input;
        saveWeeklyPlan();
        saveData();
        closeModal();
        openDayEditor(window.selectedDay);
        render();
        return;
    }

    if (modalMode === "meal") {
        const name = document.getElementById("modalInput").value.trim();
        const calories = Number(document.getElementById("modalInputCalories").value);
        const quantity = Number(document.getElementById("modalInputQuantity")?.value || 1);
        const timeValue = document.getElementById("modalInputTime")?.value || getCurrentTimeInputValue();

        if (!name) {
            showModalError("Enter a meal name.", "modalInput");
            return;
        }

        if (!Number.isFinite(calories) || calories <= 0) {
            showModalError("Enter a valid calorie count.", "modalInputCalories");
            return;
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
            showModalError("Enter a valid multiplier.", "modalInputQuantity");
            return;
        }

        data.meals.push({
            id: makeId(),
            date: getTodayString(),
            time: formatTimeForDisplay(timeValue),
            name,
            baseCalories: calories,
            quantity,
            calories: Math.round(calories * quantity),
            ...(() => { const m = readMacroInputs(); return { protein: Math.round(m.protein * quantity), carbs: Math.round(m.carbs * quantity), fat: Math.round(m.fat * quantity), baseProtein: m.protein, baseCarbs: m.carbs, baseFat: m.fat }; })()
        });

        saveData();
        closeModal();
        renderCaloriePage();
        return;
    }

    if (modalMode === "editMeal") {
        const name = document.getElementById("modalInput").value.trim();
        const calories = Number(document.getElementById("modalInputCalories").value);
        const quantity = Number(document.getElementById("modalInputQuantity")?.value || 1);
        const timeValue = document.getElementById("modalInputTime")?.value || getCurrentTimeInputValue();

        if (!name) {
            showModalError("Enter a meal name.", "modalInput");
            return;
        }

        if (!Number.isFinite(calories) || calories <= 0) {
            showModalError("Enter valid calories.", "modalInputCalories");
            return;
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
            showModalError("Enter a valid multiplier.", "modalInputQuantity");
            return;
        }

        const oldMeal = data.meals[window.editingMealIndex];

        if (!oldMeal) {
            showModalError("Could not find this meal.", "modalInput");
            return;
        }

        const actualIndex = findMealActualIndex(oldMeal);

        if (actualIndex !== -1) {
            data.meals[actualIndex].name = name;
            data.meals[actualIndex].baseCalories = calories;
            data.meals[actualIndex].quantity = quantity;
            data.meals[actualIndex].calories = Math.round(calories * quantity);
            data.meals[actualIndex].time = formatTimeForDisplay(timeValue);
            data.meals[actualIndex].id = data.meals[actualIndex].id || makeId();
            const m = readMacroInputs();
            data.meals[actualIndex].baseProtein = m.protein;
            data.meals[actualIndex].baseCarbs   = m.carbs;
            data.meals[actualIndex].baseFat     = m.fat;
            data.meals[actualIndex].protein = Math.round(m.protein * quantity);
            data.meals[actualIndex].carbs   = Math.round(m.carbs   * quantity);
            data.meals[actualIndex].fat     = Math.round(m.fat     * quantity);
        }

        saveData();
        closeModal();
        renderCaloriePage();
        return;
    }


    if (modalMode === "frequentMeal") {
        const name = document.getElementById("modalInput").value.trim();
        const calories = Number(document.getElementById("modalInputCalories").value);

        if (!name) {
            showModalError("Enter a meal name.", "modalInput");
            return;
        }

        if (!Number.isFinite(calories) || calories <= 0) {
            showModalError("Enter valid calories per serve.", "modalInputCalories");
            return;
        }

        frequentMeals.push({ id: makeId(), name, calories, ...readMacroInputs() });
        saveFrequentMeals();
        closeModal();
        renderFrequentMealsPage();
        return;
    }

    if (modalMode === "editFrequentMeal") {
        const name = document.getElementById("modalInput").value.trim();
        const calories = Number(document.getElementById("modalInputCalories").value);
        const index = window.editingFrequentMealIndex;

        if (!name) {
            showModalError("Enter a meal name.", "modalInput");
            return;
        }

        if (!Number.isFinite(calories) || calories <= 0) {
            showModalError("Enter valid calories per serve.", "modalInputCalories");
            return;
        }

        if (frequentMeals[index]) {
            frequentMeals[index].name = name;
            frequentMeals[index].calories = calories;
            const m = readMacroInputs();
            frequentMeals[index].protein = m.protein;
            frequentMeals[index].carbs   = m.carbs;
            frequentMeals[index].fat     = m.fat;
        }

        saveFrequentMeals();
        closeModal();
        renderFrequentMealsPage();
        return;
    }

    if (modalMode === "bodyFat") {
        const bodyFat = Number(input);

        if (!Number.isFinite(bodyFat) || bodyFat <= 0 || bodyFat > 70) {
            showModalError("Enter a valid body fat percentage.", "modalInput");
            return;
        }

        if (!data.fatHistory) {
            data.fatHistory = [];
        }

        data.fatHistory.push({
            date: getTodayString(),
            bodyFat
        });

        setupData.bodyFat = bodyFat;
        setStorage("setupData", setupData);

        saveData();

        renderStatsPage();
        renderCaloriePage();

        if (!setupData.targetBodyFat || setupData.targetBodyFat === "X") {
            modalMode = "targetBodyFat";
            resetModalInputs();
            document.getElementById("modalTitle").innerText = "Add Target Body Fat %";
            
            const modalInput = document.getElementById("modalInput");
            modalInput.type = "number";
            modalInput.step = "0.1";
            modalInput.min = "1";
            modalInput.placeholder = "Enter target body fat %";
            
            return;
        }

        closeModal();
        return;
    }

    if (modalMode === "targetBodyFat") {
        const targetFat = Number(input);

        if (!Number.isFinite(targetFat) || targetFat <= 0 || targetFat > 70) {
            showModalError("Enter a valid target body fat percentage.", "modalInput");
            return;
        }

        setupData.targetBodyFat = targetFat;
        setStorage("setupData", setupData);

        closeModal();
        renderStatsPage();
        renderCaloriePage();
        return;
    }

    if (modalMode === "editBodyFat") {
        const bodyFat = Number(input);

        if (!Number.isFinite(bodyFat) || bodyFat <= 0 || bodyFat > 70) {
            showModalError("Enter a valid body fat percentage.", "modalInput");
            return;
        }

        data.fatHistory[window.editingBodyFatIndex].bodyFat = bodyFat;

        saveData();
        closeModal();
        renderStatsPage();
        renderCaloriePage();
        return;
    }

    saveData();
    closeModal();
    render();
}

/* ======================
   STATS
====================== */
function renderStatsPage() {
    document.getElementById("dateText").innerText = getTodayString();

    const latest = data.weightHistory.at(-1);
    document.getElementById("weightText").innerText = latest ? `${latest.weight} kg` : "No weight yet";

    document.getElementById("nameText").innerText = setupData.name || "Unknown";
    document.getElementById("heightText").innerText = setupData.height ? `${setupData.height} cm` : "Unknown";
    document.getElementById("goalWeightText").innerText = setupData.goalWeight ? `${setupData.goalWeight} kg` : "Unknown";

    document.getElementById("bodyFatText").innerText = setupData.bodyFat ? setupData.bodyFat + "%" : "X";
    document.getElementById("targetBodyFatText").innerText = setupData.targetBodyFat ? setupData.targetBodyFat + "%" : "X";

    const container = document.getElementById("weeklyFocus");
    container.innerHTML = "";

    Object.entries(weeklyPlan).forEach(([day, info]) => {
        const div = document.createElement("div");
        div.className = "week-focus-item clickable";
        div.innerHTML = `<strong>${day}</strong>: ${info.focus}`;
        div.onclick = () => openDayEditor(day);
        container.appendChild(div);
    });

    const list = document.getElementById("weightHistoryList");
    list.innerHTML = "";

    data.weightHistory.slice(-5).forEach((entry, index) => {
        const div = document.createElement("div");
        div.className = "task-row";

        div.innerHTML = `
            <span>${entry.date}: ${entry.weight} kg</span>
            <div class="task-actions">
                <button onclick="editWeight(${index})">Edit</button>
                <button onclick="removeWeight(${index})">Remove</button>
            </div>
        `;

        list.appendChild(div);
    });

    const fatList = document.getElementById("fatHistoryList");
    fatList.innerHTML = "";

    if (!data.fatHistory) data.fatHistory = [];

    data.fatHistory.slice(-5).forEach((entry, index) => {
        const div = document.createElement("div");
        div.className = "task-row";

        div.innerHTML = `
            <span>${entry.date}: ${entry.bodyFat}%</span>
            <div class="task-actions">
                <button onclick="editBodyFat(${index})">Edit</button>
                <button onclick="removeBodyFat(${index})">Remove</button>
            </div>
        `;

        fatList.appendChild(div);
    });

    drawWeightChart();
    drawFatChart();
    updateRehabStatusText();
    autoResizeWindow();
}

function openDayEditor(day) {
    const container = document.getElementById("weeklyFocus");

    container.innerHTML = `
        <div class="day-editor-title">
            <strong>${day}</strong><br>
            Focus: ${weeklyPlan[day].focus}
            <br>
            <button onclick="editDayFocus('${day}')">Edit Focus</button>
        </div>
    `;

    weeklyPlan[day].tasks.forEach((task, i) => {
        const div = document.createElement("div");
        div.className = "week-focus-item task-row";

        div.innerHTML = `
            <span>${getTaskLabel(task)}</span>
            <div class="task-actions">
                <button onclick="editWeeklyTask('${day}', ${i})">Edit</button>
                <button onclick="removeWeeklyTask('${day}', ${i})">Remove</button>
            </div>
        `;

        container.appendChild(div);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "page-btn";
    addBtn.innerText = "+ Add Task";
    addBtn.onclick = () => openWeeklyTaskModal(day);

    const backBtn = document.createElement("button");
    backBtn.className = "page-btn";
    backBtn.innerText = "← Back";
    backBtn.onclick = renderStatsPage;

    container.appendChild(addBtn);
    container.appendChild(backBtn);

    autoResizeWindow();
}

function removeWeeklyTask(day, i) {
    weeklyPlan[day].tasks.splice(i, 1);
    saveWeeklyPlan();
    openDayEditor(day);
    render();
}

function editWeight(index) {
    modalMode = "editWeight";
    window.editingWeightIndex = index;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Edit Weight";

    const input = document.getElementById("modalInput");
    input.type = "number";
    input.step = "0.1";
    input.min = "1";
    input.placeholder = "Enter weight in kg";
    input.value = data.weightHistory[index].weight;

    openModal("modalInput");
}

function removeWeight(index) {
    data.weightHistory.splice(index, 1);
    saveData();
    renderStatsPage();
}

function editBodyFat(index) {
    modalMode = "editBodyFat";
    window.editingBodyFatIndex = index;

    resetModalInputs();

    document.getElementById("modalTitle").innerText = "Edit Body Fat %";

    const input = document.getElementById("modalInput");
    input.type = "number";
    input.step = "0.1";
    input.min = "1";
    input.placeholder = "Enter body fat percentage";
    input.value = data.fatHistory[index].bodyFat;

    openModal("modalInput");
}

function removeBodyFat(index) {
    data.fatHistory.splice(index, 1);
    saveData();
    renderStatsPage();
    renderCaloriePage();
}

/* ======================
   GRAPH
====================== */
function enableDragScroll(slider) {
    if (!slider || slider.dataset.dragEnabled) return;
    slider.dataset.dragEnabled = "true";
    let isDown = false, startX, scrollLeft;
    slider.addEventListener('mousedown', (e) => { isDown = true; startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; });
    slider.addEventListener('mouseleave', () => { isDown = false; });
    slider.addEventListener('mouseup', () => { isDown = false; });
    slider.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); slider.scrollLeft = scrollLeft - (e.pageX - slider.offsetLeft - startX); });
}

function drawWeightChart() {
    const canvas = document.getElementById("weightChart");
    if (!canvas) return;

    const parentBox = canvas.closest(".mini-chart-box") || canvas.parentElement;
    let scrollWrapper = parentBox.querySelector(".canvas-scroll-wrapper");
    if (!scrollWrapper) {
        scrollWrapper = document.createElement("div");
        scrollWrapper.className = "canvas-scroll-wrapper";
        scrollWrapper.style.width = "100%";
        scrollWrapper.style.overflowX = "auto";
        scrollWrapper.style.overflowY = "hidden";
        parentBox.appendChild(scrollWrapper);
        scrollWrapper.appendChild(canvas);
        enableDragScroll(scrollWrapper);
    }

    const weights = data.weightHistory || [];
    const padding = 25, rightBuffer = 50; 
    const visibleWidth = scrollWrapper.clientWidth || 200;
    const pointSpacing = (visibleWidth - padding * 2) / 4; 
    const totalRequiredWidth = padding + (Math.max(0, weights.length - 1) * pointSpacing) + rightBuffer;
    
    canvas.width = Math.max(visibleWidth, totalRequiredWidth);
    canvas.height = canvas.clientHeight || 150;
    canvas.style.minWidth = canvas.width + "px"; 
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (weights.length < 2) return;

    const chartHeight = canvas.height - padding * 2;
    const minWeight = Math.min(...weights.map(w => w.weight)) - 1;
    const maxWeight = Math.max(...weights.map(w => w.weight)) + 1;

    function x(i) { return padding + (i * pointSpacing); }
    function y(w) { return padding + ((maxWeight - w) / (maxWeight - minWeight)) * chartHeight; }

    ctx.strokeStyle = "#46eaff"; 
    ctx.lineWidth = 2;
    ctx.beginPath();
    weights.forEach((p, i) => { i === 0 ? ctx.moveTo(x(i), y(p.weight)) : ctx.lineTo(x(i), y(p.weight)); });
    ctx.stroke();

    ctx.fillStyle = "#ffffff";  // Changed to white
    weights.forEach((p, i) => {
        ctx.beginPath(); 
        ctx.arc(x(i), y(p.weight), 3, 0, Math.PI * 2); 
        ctx.fill();
        ctx.fillStyle = "#ffffff";  // Changed to white
        ctx.fillText(`${p.weight}kg`, x(i) - 12, y(p.weight) - 8);
    });
    scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
}

function drawFatChart() {
    const canvas = document.getElementById("fatChart");
    if (!canvas) return;
    const parentBox = canvas.closest(".mini-chart-box") || canvas.parentElement;
    
    if (!getCurrentBodyFat()) { parentBox.style.display = "none"; return; } 
    else { parentBox.style.display = ""; }

    let scrollWrapper = parentBox.querySelector(".canvas-scroll-wrapper");
    if (!scrollWrapper) {
        scrollWrapper = document.createElement("div");
        scrollWrapper.className = "canvas-scroll-wrapper";
        scrollWrapper.style.width = "100%";
        scrollWrapper.style.overflowX = "auto";
        scrollWrapper.style.overflowY = "hidden";
        parentBox.appendChild(scrollWrapper);
        scrollWrapper.appendChild(canvas);
        enableDragScroll(scrollWrapper);
    }

    const fats = data.fatHistory || [];
    const padding = 20, rightBuffer = 40; 
    const visibleWidth = scrollWrapper.clientWidth || 200;
    const pointSpacing = fats.length > 1 ? (visibleWidth - padding * 2) / 4 : 0; 
    const totalRequiredWidth = padding + (Math.max(0, fats.length - 1) * pointSpacing) + rightBuffer;
    
    canvas.width = Math.max(visibleWidth, totalRequiredWidth);
    canvas.height = canvas.clientHeight || 150;
    canvas.style.minWidth = canvas.width + "px";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const chartHeight = canvas.height - padding * 2;
    const minFat = fats.length > 0 ? Math.min(...fats.map(f => f.bodyFat)) - 1 : 0;
    const maxFat = fats.length > 0 ? Math.max(...fats.map(f => f.bodyFat)) + 1 : 100;

    function x(i) { return padding + (i * pointSpacing); }
    function y(f) { return padding + ((maxFat - f) / (maxFat - minFat)) * chartHeight; }

    if (fats.length > 1) {
        ctx.strokeStyle = "#46eaff"; 
        ctx.lineWidth = 2; 
        ctx.beginPath();
        fats.forEach((p, i) => { i === 0 ? ctx.moveTo(x(i), y(p.bodyFat)) : ctx.lineTo(x(i), y(p.bodyFat)); });
        ctx.stroke();
    }
    
    ctx.fillStyle = "#ffffff";  // Changed to white
    fats.forEach((p, i) => {
        ctx.beginPath(); 
        ctx.arc(x(i), y(p.bodyFat), 3, 0, Math.PI * 2); 
        ctx.fill();
        ctx.fillStyle = "#ffffff";  // Changed to white
        ctx.fillText(`${p.bodyFat}%`, x(i) - 10, y(p.bodyFat) - 7);
    });
    scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
}

/* ======================
   TIMER
====================== */
function updateTimer() {
    checkNewDay();

    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);

    const diff = midnight - now;

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    timerDiv.innerText =
        `Time Left: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ======================
   REHAB
====================== */

function getPainRange(pain) {
    if (pain <= 3) return "low";
    if (pain <= 6) return "medium";
    return "high";
}

function getRecoveryDays(bodyPart, pain) {
    const range = getPainRange(pain);

    const recoveryMap = {
        low: {
            neck: 3,
            shoulder: 5,
            arm: 4,
            back: 5,
            hip: 5,
            knee: 5,
            ankle: 5,
            shin: 7
        },
        medium: {
            neck: 7,
            shoulder: 10,
            arm: 7,
            back: 10,
            hip: 10,
            knee: 10,
            ankle: 10,
            shin: 14
        },
        high: {
            neck: 14,
            shoulder: 14,
            arm: 14,
            back: 14,
            hip: 14,
            knee: 14,
            ankle: 14,
            shin: 21
        }
    };

    return recoveryMap[range][bodyPart] || 7;
}

function getRecoveryDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString("en-AU");
}

function getRehabTasks(bodyPart, pain) {
    const range = getPainRange(pain);
    return rehabProtocols[bodyPart]?.[range] || [];
}

function addRehabTasksToToday() {
    if (!rehabData.active || rehabData.needsReview) return;

    rehabData.tasks.forEach(task => {
        const rehabTask = `[Rehab] ${task}`;

        if (!data.tempTasks.includes(rehabTask)) {
            data.tempTasks.push(rehabTask);
        }
    });

    saveData();
}

function checkRehabStatus() {
    if (!rehabData.active) return;

    const today = new Date(getTodayString());
    const recoveryDate = new Date(rehabData.recoveryUntil);

    if (today > recoveryDate) {
        rehabData.needsReview = true;
        saveRehabData();
        return;
    }

    addRehabTasksToToday();
}

function clearRehabProtocol() {
    rehabData = {
        active: false,
        bodyPart: "",
        pain: 0,
        recoveryUntil: "",
        tasks: [],
        needsReview: false
    };

    saveRehabData();

    data.tempTasks = data.tempTasks.filter(task => !task.startsWith("[Rehab]"));
    saveData();

    renderRehabPage();
    renderStatsPage();
    render();
}

function startRehabProtocol(bodyPart, pain) {
    const days = getRecoveryDays(bodyPart, pain);
    const tasks = getRehabTasks(bodyPart, pain);

    rehabData = {
        active: true,
        bodyPart,
        pain,
        recoveryUntil: getRecoveryDate(days),
        tasks,
        needsReview: false
    };

    saveRehabData();

    addRehabTasksToToday();
    renderRehabPage();
    renderStatsPage();
    render();
}

function renderRehabPage() {
    const content = document.getElementById("rehabContent");
    if (!content) return;

    if (!rehabData.active) {
        content.innerHTML = `
            <div class="stat-box">
                <p><strong>Select injured area:</strong></p>
                <p>Pain scale: 1 = barely there, 10 = go-to-hospital type injury.</p>
            </div>

            <div class="rehab-option-grid">
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('neck')">Neck</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('shoulder')">Shoulder</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('arm')">Arm / Bicep</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('back')">Back</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('hip')">Hip</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('knee')">Knee</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('ankle')">Ankle</button>
                <button class="rehab-option-btn" onclick="selectRehabBodyPart('shin')">Shin</button>
            </div>
        `;

        autoResizeWindow();
        return;
    }

    if (rehabData.needsReview) {
        content.innerHTML = `
            <div class="stat-box">
                <p><strong>Recovery date reached.</strong></p>
                <p>Area: ${rehabData.bodyPart}</p>
                <p>Last pain rating: ${rehabData.pain}/10</p>
                <p>Are you fully healed, or do you need another rehab cycle?</p>
            </div>

            <button class="page-btn" onclick="clearRehabProtocol()">
                I'm fully healed
            </button>

            <button class="page-btn" onclick="selectRehabBodyPart('${rehabData.bodyPart}')">
                Re-check pain level
            </button>
        `;

        autoResizeWindow();
        return;
    }

    const taskHtml = rehabData.tasks
        .map(task => `<div class="rehab-task-preview">${task}</div>`)
        .join("");

    content.innerHTML = `
        <div class="stat-box">
            <p><strong>Active Rehab Protocol</strong></p>
            <p><strong>Area:</strong> ${rehabData.bodyPart}</p>
            <p><strong>Pain:</strong> ${rehabData.pain}/10</p>
            <p><strong>Estimated recovery until:</strong> ${rehabData.recoveryUntil}</p>
        </div>

        ${rehabData.pain >= 7 ? `
            <div class="rehab-warning">
                Pain is high. These are gentle recovery tasks only. If pain is severe, worsening, swollen, unstable, numb, or affecting normal movement, consider seeing a doctor or physio.
            </div>
        ` : ""}

        <h2>Rehab Tasks Added</h2>
        ${taskHtml}

        <button class="page-btn danger-btn" onclick="clearRehabProtocol()">
            End Rehab Protocol
        </button>
    `;

    autoResizeWindow();
}

function selectRehabBodyPart(bodyPart) {
    const content = document.getElementById("rehabContent");

    content.innerHTML = `
        <div class="stat-box">
            <p><strong>Selected:</strong> ${bodyPart}</p>
            <p>Rate pain from 1–10.</p>
            <p>1 = barely there. 10 = go-to-hospital type injury.</p>
        </div>

        <div class="rehab-option-grid">
            ${[1,2,3,4,5,6,7,8,9,10].map(num => `
                <button class="rehab-option-btn" onclick="confirmRehabPain('${bodyPart}', ${num})">
                    ${num}
                </button>
            `).join("")}
        </div>

        <button class="page-btn" onclick="renderRehabPage()">
            ← Back
        </button>
    `;

    autoResizeWindow();
}

function confirmRehabPain(bodyPart, pain) {
    const days = getRecoveryDays(bodyPart, pain);
    const tasks = getRehabTasks(bodyPart, pain);

    const taskHtml = tasks
        .map(task => `<div class="rehab-task-preview">${task}</div>`)
        .join("");

    const content = document.getElementById("rehabContent");

    content.innerHTML = `
        <div class="stat-box">
            <p><strong>Area:</strong> ${bodyPart}</p>
            <p><strong>Pain:</strong> ${pain}/10</p>
            <p><strong>Estimated recovery:</strong> ${days} days</p>
            <p><strong>Recovery until:</strong> ${getRecoveryDate(days)}</p>
        </div>

        ${pain >= 7 ? `
            <div class="rehab-warning">
                Pain is high. This should stay very gentle. If this feels serious, unstable, sharp, swollen, numb, or unusually painful, consider seeing a doctor or physio.
            </div>
        ` : ""}

        <h2>Exercises to be added</h2>
        ${taskHtml}

        <button class="page-btn" onclick="startRehabProtocol('${bodyPart}', ${pain})">
            Start Rehab Protocol
        </button>

        <button class="page-btn" onclick="selectRehabBodyPart('${bodyPart}')">
            ← Change Pain Rating
        </button>
    `;

    autoResizeWindow();
}

function updateRehabStatusText() {
    const rehabStatusText = document.getElementById("rehabStatusText");
    if (!rehabStatusText) return;

    if (!rehabData.active) {
        rehabStatusText.innerText = "No active rehab protocol";
        return;
    }

    if (rehabData.needsReview) {
        rehabStatusText.innerText = `${rehabData.bodyPart} needs review`;
        return;
    }

    rehabStatusText.innerText =
        `${rehabData.bodyPart} rehab active until ${rehabData.recoveryUntil}`;
}

/* ======================
   NAV
====================== */
function hideAllPages() {
    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "none";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("rehabPage").style.display = "none";
    const frequentPage = document.getElementById("frequentMealPage");
    if (frequentPage) frequentPage.style.display = "none";
    const notifPage = document.getElementById("notificationsPage");
    if (notifPage) notifPage.style.display = "none";
}

function goToStats() {
    hideAllPages();
    document.getElementById("statsPage").style.display = "flex";
    renderStatsPage();
}

function goToTasks() {
    hideAllPages();
    document.getElementById("tasksPage").style.display = "flex";
    render();
}

function goToRehab() {
    hideAllPages();
    document.getElementById("rehabPage").style.display = "flex";
    renderRehabPage();
    setTimeout(autoResizeWindow, 50);
}

function confirmFullReset() {
    const confirmed = confirm(
        "This will delete EVERYTHING: registration, weekly plan, tasks, meals, weights, and progress. Are you sure?"
    );

    if (!confirmed) return;

    localStorage.removeItem("soloSystem_public_setupData");
    localStorage.removeItem("soloSystem_public_weeklyPlan");
    localStorage.removeItem("soloSystem_public_questData");

    setupStep = 0;

    setupData = {
        complete: false,
        name: "",
        height: "",
        currentWeight: "",
        goalWeight: "",
        bodyFat: "",
        targetBodyFat: "",
        weeklyPlan: {}
    };

    weeklyPlan = defaultWeeklyPlan;

    data = {
        date: getTodayString(),
        completed: {},
        tempTasks: [],
        meals: [],
        weightHistory: []
    };

    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("tasksPage").style.display = "none";
    document.getElementById("setupOverlay").style.display = "flex";

    renderSetupStep();
    autoResizeWindow();
}

const rehabProtocols = {
    neck: {
        low: [
            "Neck rotations — 2 x 8 each side",
            "Chin tucks — 2 x 10",
            "Upper trap stretch — 30s each side"
        ],
        medium: [
            "Gentle chin tucks — 2 x 8",
            "Neck isometrics — 3 x 5s each direction",
            "Avoid heavy overhead lifting"
        ],
        high: [
            "Rest neck from loading",
            "Gentle pain-free movement only",
            "Consider seeing a doctor or physio"
        ]
    },

    shoulder: {
        low: [
            "Band external rotations — 2 x 12",
            "Wall slides — 2 x 10",
            "Scapular squeezes — 2 x 12"
        ],
        medium: [
            "Scapular squeezes — 2 x 10",
            "Pendulum swings — 2 x 30s",
            "Avoid pressing movements"
        ],
        high: [
            "Avoid shoulder loading",
            "Gentle pendulum swings only",
            "Consider seeing a doctor or physio"
        ]
    },

    arm: {
        low: [
            "Wrist circles — 2 x 10",
            "Light forearm stretch — 30s each",
            "Gentle bicep/tricep mobility — 2 x 10"
        ],
        medium: [
            "Gentle arm mobility — 2 x 10",
            "Avoid curls and pressing",
            "Light stretching only"
        ],
        high: [
            "Rest arm from loading",
            "Pain-free range of motion only",
            "Consider seeing a doctor or physio"
        ]
    },

    back: {
        low: [
            "Cat-cow — 2 x 10",
            "Child's pose — 45s",
            "Glute bridges — 2 x 12"
        ],
        medium: [
            "Cat-cow — 2 x 8",
            "Dead bugs — 2 x 8 each",
            "Avoid heavy bending/lifting"
        ],
        high: [
            "Avoid loaded bending",
            "Gentle walking only if pain-free",
            "Consider seeing a doctor or physio"
        ]
    },

    hip: {
        low: [
            "Hip circles — 2 x 10 each",
            "Glute bridges — 3 x 12",
            "Couch stretch — 30s each"
        ],
        medium: [
            "Glute bridges — 2 x 10",
            "Hip flexor stretch — 30s each",
            "Avoid sprinting and deep lunges"
        ],
        high: [
            "Avoid hard lower-body training",
            "Gentle pain-free mobility only",
            "Consider seeing a doctor or physio"
        ]
    },

    knee: {
        low: [
            "Quad sets — 3 x 10",
            "Glute bridges — 3 x 12",
            "Step-downs — 2 x 8 each"
        ],
        medium: [
            "Quad sets — 3 x 10",
            "Glute bridges — 2 x 10",
            "Avoid jumping and sprinting"
        ],
        high: [
            "Avoid knee loading",
            "Gentle pain-free movement only",
            "Consider seeing a doctor or physio"
        ]
    },

    ankle: {
        low: [
            "Ankle circles — 2 x 10 each direction",
            "Calf raises — 3 x 12",
            "Single-leg balance — 3 x 20s each"
        ],
        medium: [
            "Ankle circles — 2 x 10",
            "Seated calf raises — 2 x 12",
            "Avoid jumping and running"
        ],
        high: [
            "Avoid ankle loading",
            "Gentle ankle movement only",
            "Consider seeing a doctor or physio"
        ]
    },

    shin: {
        low: [
            "Tibialis raises — 2 x 12",
            "Calf stretch — 30s each",
            "Low-impact bike — 10 mins"
        ],
        medium: [
            "Tibialis raises — 2 x 10",
            "Calf stretch — 30s each",
            "Avoid running and jumping"
        ],
        high: [
            "Avoid impact training",
            "Low-impact movement only if pain-free",
            "Consider seeing a doctor or physio"
        ]
    }
};

/* ======================
   INIT
====================== */
document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();

    if (
        e.key === "Enter" &&
        document.getElementById("inputModal").style.display === "flex"
    ) {
        submitModal();
    }
});

setInterval(() => {
    if (setupData.complete) {
        updateTimer();
    }
}, 1000);

if (!setupData.complete) {
    startSetupIfNeeded();
} else {
    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "flex";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("rehabPage").style.display = "none";
    checkRehabStatus();
    render();
    updateTimer();
}

let lastTriggeredReminder = "";

/* ==================================================
   NOTIFICATIONS PAGE
================================================== */

function openNotificationSettings() {
    hideAllPages();
    const notifPage = document.getElementById("notificationsPage");
    if (notifPage) {
        notifPage.style.display = "flex";
        renderNotificationsPage();
    }
    autoResizeWindow();
}

function closeNotificationsPage() {
    const notifPage = document.getElementById("notificationsPage");
    if (notifPage) notifPage.style.display = "none";
    document.getElementById("tasksPage").style.display = "flex";
    autoResizeWindow();
}

function renderNotificationsPage() {
    renderWorkoutReminders();
    renderMotivationSettings();
}

function renderWorkoutReminders() {
    const list = document.getElementById("reminderList");
    if (!list) return;
    list.innerHTML = "";

    if (!setupData.reminders) setupData.reminders = [];

    if (!setupData.reminders.length) {
        list.innerHTML = `<div class="notif-empty">No reminders set yet.</div>`;
        return;
    }

    setupData.reminders.forEach((time, index) => {
        const div = document.createElement("div");
        div.className = "task-row reminder-row";
        div.innerHTML = `
            <input
                class="setup-input"
                type="time"
                value="${escapeHtml(time)}"
                onchange="updateReminder(${index}, this.value)"
            >
            <button class="remove-btn" onclick="removeReminder(${index})">Remove</button>
        `;
        list.appendChild(div);
    });
}

function addWorkoutReminder() {
    const timeInput = document.getElementById("newReminderTime");
    const err = document.getElementById("reminderError");

    if (!timeInput || !timeInput.value) {
        if (err) err.innerText = "Please select a time.";
        return;
    }

    if (err) err.innerText = "";
    if (!setupData.reminders) setupData.reminders = [];

    if (!setupData.reminders.includes(timeInput.value)) {
        setupData.reminders.push(timeInput.value);
        setupData.reminders.sort();
        setStorage("setupData", setupData);
    }

    timeInput.value = "";
    requestNotificationAccess();
    renderWorkoutReminders();
    autoResizeWindow();
}

function updateReminder(index, time) {
    if (!setupData.reminders || !time) return;

    setupData.reminders[index] = time;
    setupData.reminders = [...new Set(setupData.reminders)].sort();
    setStorage("setupData", setupData);
    renderWorkoutReminders();
    autoResizeWindow();
}

function removeReminder(index) {
    if (!setupData.reminders) return;
    setupData.reminders.splice(index, 1);
    setStorage("setupData", setupData);
    renderWorkoutReminders();
    autoResizeWindow();
}

function renderMotivationSettings() {
    const statusEl = document.getElementById("motivationStatus");
    if (!statusEl) return;

    const enabled = setupData.motivationEnabled !== false;
    const permission = getNotificationPermissionLabel();

    statusEl.innerText = enabled
        ? `Enabled. Sends 1-3 motivational alerts per day at random times. Permission: ${permission}.`
        : `Disabled. Permission: ${permission}.`;

    const toggleBtn = document.getElementById("motivationToggleBtn");
    if (toggleBtn) toggleBtn.innerText = enabled ? "Disable" : "Enable";
}

function toggleMotivationNotifications() {
    const enabled = setupData.motivationEnabled !== false;
    setupData.motivationEnabled = !enabled;
    setStorage("setupData", setupData);

    if (setupData.motivationEnabled) {
        ensureMotivationSchedule(true);
        requestNotificationAccess();
    }

    renderMotivationSettings();
}

function getNotificationPermissionLabel() {
    if (!("Notification" in window)) return "not supported";
    return Notification.permission;
}

function requestNotificationAccess() {
    if (!("Notification" in window)) {
        alert("This browser does not support notifications.");
        return;
    }

    if (!window.isSecureContext) {
        alert("Notifications need the app to be opened from HTTPS, localhost, or as an installed phone app.");
        renderMotivationSettings();
        return;
    }

    if (Notification.permission === "default") {
        Notification.requestPermission().then(() => {
            ensureMotivationSchedule(true);
            renderMotivationSettings();
        });
        return;
    }

    if (Notification.permission === "granted") {
        ensureMotivationSchedule(true);
        renderMotivationSettings();
    } else {
        alert("Notifications are blocked. Please enable them in your browser/app settings.");
        renderMotivationSettings();
    }
}

async function sendAppNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const options = {
        body,
        tag: `solo-system-${Date.now()}`,
        renotify: false
    };

    if ("serviceWorker" in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            if (registration?.showNotification) {
                registration.showNotification(title, options);
                return;
            }
        } catch (error) {
            // Fall back to the page notification API below.
        }
    }

    new Notification(title, options);
}

function ensureMotivationSchedule(forceNew = false) {
    if (setupData.motivationEnabled === false) return null;

    const today = getNotificationDayKey();
    const saved = getStorage("motivationSchedule");

    if (!forceNew && saved?.date === today && Array.isArray(saved.items)) {
        return saved;
    }

    const count = Math.floor(Math.random() * 3) + 1;
    const times = new Set();
    const usedQuotes = new Set();
    const items = [];

    while (times.size < count) {
        const hour = Math.floor(Math.random() * 12) + 8;
        const minute = Math.floor(Math.random() * 60);
        times.add(hour.toString().padStart(2, "0") + ":" + minute.toString().padStart(2, "0"));
    }

    [...times].sort().forEach(time => {
        let quoteIndex;
        do {
            quoteIndex = Math.floor(Math.random() * motivationalQuotes.length);
        } while (usedQuotes.has(quoteIndex) && usedQuotes.size < motivationalQuotes.length);

        usedQuotes.add(quoteIndex);
        items.push({ time, quoteIndex });
    });

    const schedule = { date: today, items };
    setStorage("motivationSchedule", schedule);
    setStorage("triggeredMotivationNotifications", {});
    return schedule;
}

function getNotificationDayKey(date = new Date()) {
    return date.getFullYear() + "-" +
        String(date.getMonth() + 1).padStart(2, "0") + "-" +
        String(date.getDate()).padStart(2, "0");
}

function getTimeString(date = new Date()) {
    return date.getHours().toString().padStart(2, "0") + ":" +
        date.getMinutes().toString().padStart(2, "0");
}

function wasMotivationTriggered(key) {
    const triggered = getStorage("triggeredMotivationNotifications") || {};
    return !!triggered[key];
}

function markMotivationTriggered(key) {
    const triggered = getStorage("triggeredMotivationNotifications") || {};
    triggered[key] = true;
    setStorage("triggeredMotivationNotifications", triggered);
}

function checkMotivationNotifications(now = new Date()) {
    const schedule = ensureMotivationSchedule();
    if (!schedule) return;

    const today = getNotificationDayKey(now);
    const timeStr = getTimeString(now);
    const minuteKey = `${today}:${timeStr}`;
    if (lastMotivationCheckMinute === minuteKey) return;
    lastMotivationCheckMinute = minuteKey;

    const item = schedule.items.find(entry => entry.time === timeStr);
    if (!item) return;

    const triggerKey = `${today}:motivation:${timeStr}`;
    if (wasMotivationTriggered(triggerKey)) return;

    sendAppNotification("Solo System Alert", motivationalQuotes[item.quoteIndex]);
    markMotivationTriggered(triggerKey);
}

function resetReminderDayIfNeeded() {
    const today = getNotificationDayKey();
    if (lastReminderCheckDay === today) return;

    lastReminderCheckDay = today;
    lastTriggeredReminder = "";
}

function checkReminderNotifications(now = new Date()) {
    if (!setupData.reminders || setupData.reminders.length === 0) return;

    const timeStr = getTimeString(now);
    if (!setupData.reminders.includes(timeStr) || lastTriggeredReminder === timeStr) return;

    sendAppNotification("Solo System", "Time to train! Your daily quest awaits.");
    lastTriggeredReminder = timeStr;
}

function checkPhoneNotifications() {
    resetReminderDayIfNeeded();
    checkReminderNotifications();
    checkMotivationNotifications();
}

function scheduleRandomNotifications() {
    ensureMotivationSchedule();
    checkPhoneNotifications();
}

let lastMotivationCheckMinute = "";
let lastReminderCheckDay = getNotificationDayKey(new Date());

setInterval(checkPhoneNotifications, 15000);
window.addEventListener("focus", checkPhoneNotifications);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkPhoneNotifications();
});
ensureMotivationSchedule();

const motivationalQuotes = [
    "Arise, Hunter. It is time to train.",
    "The dungeon won't clear itself. Get moving!",
    "Strength isn't given, it's earned. Go train.",
    "A moment of rest is a moment of weakness.",
    "Your stats won't increase if you stay still!",
    "Every rep is a step closer to your final form.",
    "Pain is temporary. Glory is forever.",
    "The grind doesn't stop. Neither do you.",
    "You didn't come this far to only come this far.",
    "Level up. The quest won't complete itself.",
    "Champions train when no one is watching.",
    "Your future self is counting on today's effort.",
    "One more set. One more step. One more win.",
    "Weak excuses build weak bodies. Get moving.",
    "The iron never lies. Show up and lift."
];

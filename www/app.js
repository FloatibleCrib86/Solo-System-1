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
const HISTORY_PREVIEW_LIMIT = 5;

const setupDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

let setupData = getStorage("setupData") || {
    complete: false,
    name: "",
    height: "",
    currentWeight: "",
    goalWeight: "",
    bodyFat: "",
    targetBodyFat: "",
    age: "",
    sex: "male",
    activityLevel: "Moderate",
    calorieMode: "Cutting",
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

let weeklyPlan = getStorage("weeklyPlan") || defaultWeeklyPlan;
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
    if (latest && latest.weight) {
        return Number(latest.weight);
    }
    if (setupData.currentWeight && setupData.currentWeight !== "") {
        return Number(setupData.currentWeight);
    }
    return 70;
}

function getCurrentBodyFat() {
    const latest = data?.fatHistory?.at(-1);
    if (latest && latest.bodyFat) {
        return Number(latest.bodyFat);
    }
    if (setupData.bodyFat && setupData.bodyFat !== "") {
        return Number(setupData.bodyFat);
    }
    const sex = setupData.sex || "male";
    return sex === "female" ? 22 : 15;
}

function getTargetBodyFat() {
    return Number(setupData.targetBodyFat) || 0;
}

function getActivityMultiplier() {
    const multipliers = {
        "Sedentary": 1.2,
        "Light": 1.375,
        "Moderate": 1.55,
        "Active": 1.725
    };
    return multipliers[setupData.activityLevel || "Moderate"] || 1.55;
}

function calculateBMR() {
    const weight = getCurrentWeight();
    const bodyFat = getCurrentBodyFat();
    
    if (bodyFat > 0 && bodyFat < 50) {
        const leanMass = weight * (1 - bodyFat / 100);
        return 370 + (21.6 * leanMass);
    } else {
        const height = getHeight();
        const age = Number(setupData.age) || 25;
        const sex = (setupData.sex || "male").toLowerCase();
        if (sex === "female") {
            return (10 * weight) + (6.25 * height) - (5 * age) - 161;
        } else {
            return (10 * weight) + (6.25 * height) - (5 * age) + 5;
        }
    }
}

function calculateTDEE() {
    return Math.round(calculateBMR() * getActivityMultiplier());
}

function getSelectedCalories() {
    const tdee = calculateTDEE();
    const mode = setupData.calorieMode || "Cutting";
    
    if (mode === "Bulking") {
        return tdee + 400;
    } else if (mode === "Maintaining") {
        return tdee;
    } else {
        return tdee - 500;
    }
}

function getCaloriesLeftToday() {
    return getSelectedCalories() - getCaloriesEatenToday();
}

function getProteinTargetToday() {
    const bodyFat = getCurrentBodyFat();
    let weight = getCurrentWeight();
    const activityLevel = setupData.activityLevel || "Moderate";
    const calorieMode = setupData.calorieMode || "Cutting";
    
    if (!weight || weight <= 0) weight = 70;
    
    let leanMass = weight;
    if (bodyFat > 0 && bodyFat < 50) {
        leanMass = weight * (1 - bodyFat / 100);
    }
    
    const activityProteinMap = {
        "Sedentary": 1.6,
        "Light": 1.8,
        "Moderate": 2.0,
        "Active": 2.2
    };
    let baseProteinPerKg = activityProteinMap[activityLevel] || 2.0;
    
    let modeMultiplier = 1.0;
    if (calorieMode === "Cutting") {
        modeMultiplier = 1.2;
    } else if (calorieMode === "Bulking") {
        modeMultiplier = 1.3;
    }
    
    let proteinTarget = Math.round(leanMass * baseProteinPerKg * modeMultiplier);
    const minProtein = Math.round(weight * 1.6);
    return Math.max(proteinTarget, minProtein);
}

function getFatTargetToday() {
    const selectedCalories = getSelectedCalories();
    const calorieMode = setupData.calorieMode || "Cutting";
    
    let fatPercentage = 0.25;
    if (calorieMode === "Cutting") {
        fatPercentage = 0.20;
    } else if (calorieMode === "Bulking") {
        fatPercentage = 0.25;
    }
    
    return Math.round((selectedCalories * fatPercentage) / 9);
}

function getCarbsTargetToday() {
    const selectedCalories = getSelectedCalories();
    const proteinCalories = getProteinTargetToday() * 4;
    const fatCalories = getFatTargetToday() * 9;
    let remainingCalories = selectedCalories - proteinCalories - fatCalories;
    
    const minCarbsCalories = selectedCalories * 0.2;
    if (remainingCalories < minCarbsCalories) {
        remainingCalories = minCarbsCalories;
    }
    
    return Math.round(remainingCalories / 4);
}

function cycleActivityLevel() {
    const levels = ["Sedentary", "Light", "Moderate", "Active"];
    const currentIndex = levels.indexOf(setupData.activityLevel || "Moderate");
    setupData.activityLevel = levels[(currentIndex + 1) % levels.length];
    setStorage("setupData", setupData);
    
    console.log("Activity changed to:", setupData.activityLevel);
    
    // Force a complete re-render of the calorie page
    renderCaloriePage();
    
    // Show feedback message
    const activity = setupData.activityLevel;
    const proteinValue = getProteinTargetToday();
    
    const msg = document.createElement("div");
    msg.style.position = "fixed";
    msg.style.bottom = "20px";
    msg.style.left = "50%";
    msg.style.transform = "translateX(-50%)";
    msg.style.backgroundColor = "#46eaff";
    msg.style.color = "#03101f";
    msg.style.padding = "8px 16px";
    msg.style.borderRadius = "8px";
    msg.style.fontSize = "12px";
    msg.style.zIndex = "1000";
    msg.innerHTML = `🏃 Activity: ${activity}<br>💪 Protein: ${proteinValue}g<br>🍚 Carbs: ${getCarbsTargetToday()}g<br>🥑 Fat: ${getFatTargetToday()}g`;
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 2500);
    
    autoResizeWindow();
}

function cycleCalorieMode() {
    const modes = ["Cutting", "Maintaining", "Bulking"];
    const currentIndex = modes.indexOf(setupData.calorieMode || "Cutting");
    setupData.calorieMode = modes[(currentIndex + 1) % modes.length];
    setStorage("setupData", setupData);
    
    console.log("Mode changed to:", setupData.calorieMode);
    
    // Force a complete re-render of the calorie page
    renderCaloriePage();
    
    // Show feedback message
    const mode = setupData.calorieMode;
    const proteinValue = getProteinTargetToday();
    let icon = "";
    if (mode === "Cutting") icon = "🔥 Cutting (-500 kcal)";
    if (mode === "Bulking") icon = "💪 Bulking (+400 kcal)";
    if (mode === "Maintaining") icon = "⚖️ Maintaining";
    
    const msg = document.createElement("div");
    msg.style.position = "fixed";
    msg.style.bottom = "20px";
    msg.style.left = "50%";
    msg.style.transform = "translateX(-50%)";
    msg.style.backgroundColor = "#46eaff";
    msg.style.color = "#03101f";
    msg.style.padding = "8px 16px";
    msg.style.borderRadius = "8px";
    msg.style.fontSize = "12px";
    msg.style.zIndex = "1000";
    msg.innerHTML = `${icon}<br>💪 Protein: ${proteinValue}g<br>🍚 Carbs: ${getCarbsTargetToday()}g<br>🥑 Fat: ${getFatTargetToday()}g`;
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 2500);
    
    autoResizeWindow();
}

function getMacroTotalsForView() {
    return getMealsForCalorieView().reduce(
        (acc, meal) => ({
            protein: acc.protein + (meal.protein || 0),
            carbs: acc.carbs + (meal.carbs || 0),
            fat: acc.fat + (meal.fat || 0)
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
            weightHistory: saved.weightHistory || [],
            fatHistory: saved.fatHistory || []
        };
    }

    return {
        date: saved.date,
        completed: saved.completed || {},
        tempTasks: saved.tempTasks || [],
        meals: saved.meals || [],
        weightHistory: saved.weightHistory || [],
        fatHistory: saved.fatHistory || []
    };
}

let data = loadData();
removeSeededRegistrationHistoryOnce();
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

function removeSeededRegistrationHistoryOnce() {
    if (getStorage("historySeedMigrationComplete")) return;

    if (data.weightHistory?.length === 1 && Number(data.weightHistory[0].weight) === Number(setupData.currentWeight)) {
        data.weightHistory = [];
    }
    const defaultBodyFat = setupData.sex === "female" ? 22 : 15;
    const seededBodyFat = setupData.bodyFat ? Number(setupData.bodyFat) : defaultBodyFat;
    if (data.fatHistory?.length === 1 && Number(data.fatHistory[0].bodyFat) === seededBodyFat) {
        data.fatHistory = [];
    }

    setStorage("historySeedMigrationComplete", true);
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
        subtitle.innerText = "Enter player info (Required: Height, Current Weight, Target Weight)";
        content.innerHTML = `
            <input class="setup-input" id="setupName" placeholder="Name (Optional)" value="${setupData.name === 'user' ? '' : (setupData.name || "")}">
            <input class="setup-input" id="setupHeight" type="number" placeholder="Height in cm *REQUIRED*" value="${setupData.height || ""}" required>
            <input class="setup-input" id="setupCurrentWeight" type="number" placeholder="Current weight in kg *REQUIRED*" value="${setupData.currentWeight || ""}" required>
            <input class="setup-input" id="setupGoalWeight" type="number" placeholder="Goal weight in kg *REQUIRED*" value="${setupData.goalWeight || ""}" required>
            <input class="setup-input" id="setupAge" type="number" placeholder="Age *REQUIRED*" value="${setupData.age || ""}">
            <select class="setup-input" id="setupSex"><option value="male" ${setupData.sex === "male" ? "selected" : ""}>Male</option><option value="female" ${setupData.sex === "female" ? "selected" : ""}>Female</option></select>
            <input class="setup-input" id="setupBodyFat" type="number" placeholder="Body Fat % (Optional)" value="${setupData.bodyFat || ""}">
            <input class="setup-input" id="setupTargetBodyFat" type="number" placeholder="Target Body Fat % (Optional)" value="${setupData.targetBodyFat || ""}">
        `;
        return;
    }

    const day = setupDays[setupStep - 1];
    const dayPlan = setupData.weeklyPlan[day] || { focus: "Training", tasks: [] };

    subtitle.innerText = `Set up ${day}`;

    content.innerHTML = `
        <input class="setup-input" id="setupFocus" placeholder="Name this day's focus" value="${dayPlan.focus || "Training"}">
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
            <input class="setup-input setup-task-value" type="number" min="0" value="${escapeHtml(t.value)}" placeholder="Value">
            <select class="setup-input setup-task-unit">
                <option value="reps" ${t.unit === "reps" ? "selected" : ""}>Reps</option>
                <option value="seconds" ${t.unit === "seconds" ? "selected" : ""}>Seconds</option>
                <option value="minutes" ${t.unit === "minutes" ? "selected" : ""}>Minutes</option>
                <option value="hours" ${t.unit === "hours" ? "selected" : ""}>Hours</option>
            </select>
            <input class="setup-input setup-task-sets" type="number" min="0" value="${escapeHtml(t.sets)}" placeholder="Sets">
            <input class="setup-input setup-task-weight" value="${escapeHtml(t.weight)}" placeholder="Weight">
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
        setupData.age = document.getElementById("setupAge").value.trim();
        setupData.sex = document.getElementById("setupSex").value;
        setupData.bodyFat = document.getElementById("setupBodyFat").value.trim();
        setupData.targetBodyFat = document.getElementById("setupTargetBodyFat").value.trim();
        return;
    }

    const day = setupDays[setupStep - 1];
    const focus = document.getElementById("setupFocus").value.trim() || "Training";
    const taskRows = [...document.querySelectorAll(".setup-task")];

    const tasks = taskRows
        .map(row => createExerciseTask(
            row.querySelector(".setup-task-name")?.value.trim() || "",
            row.querySelector(".setup-task-value")?.value.trim() || "",
            row.querySelector(".setup-task-unit")?.value || "reps",
            row.querySelector(".setup-task-sets")?.value.trim() || "",
            row.querySelector(".setup-task-weight")?.value.trim() || ""
        ))
        .filter(task => task.name);

    setupData.weeklyPlan[day] = { focus, tasks };
}

function setupNext(event) {
    if (event?.preventDefault) event.preventDefault();

    if (setupStep === 0) {
        const height = document.getElementById("setupHeight").value.trim();
        const currentWeight = document.getElementById("setupCurrentWeight").value.trim();
        const goalWeight = document.getElementById("setupGoalWeight").value.trim();

        if (!height) {
            alert("Height is required! Please enter your height in cm.");
            document.getElementById("setupHeight").focus();
            return;
        }
        if (!currentWeight) {
            alert("Current Weight is required! Please enter your current weight in kg.");
            document.getElementById("setupCurrentWeight").focus();
            return;
        }
        if (!goalWeight) {
            alert("Target Weight is required! Please enter your goal weight in kg.");
            document.getElementById("setupGoalWeight").focus();
            return;
        }
        if (Number(height) <= 0) {
            alert("Please enter a valid height (positive number).");
            return;
        }
        if (Number(currentWeight) <= 0) {
            alert("Please enter a valid current weight (positive number).");
            return;
        }
        if (Number(goalWeight) <= 0) {
            alert("Please enter a valid target weight (positive number).");
            return;
        }
    }

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
        <input class="setup-input setup-task-value" type="number" min="0" placeholder="Value">
        <select class="setup-input setup-task-unit">
            <option value="reps">Reps</option>
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
        </select>
        <input class="setup-input setup-task-sets" type="number" min="0" placeholder="Sets">
        <input class="setup-input setup-task-weight" placeholder="Weight">
        <button onclick="this.parentElement.remove()">×</button>
    `;
    list.appendChild(row);
    autoResizeWindow();
}

function finishSetup() {
    console.log("Finishing setup...");

    if (!setupData.height) {
        alert("Height is required. Please go back and enter your height.");
        setupStep = 0;
        renderSetupStep();
        return;
    }
    if (!setupData.currentWeight) {
        alert("Current Weight is required. Please go back and enter your weight.");
        setupStep = 0;
        renderSetupStep();
        return;
    }
    if (!setupData.goalWeight) {
        alert("Target Weight is required. Please go back and enter your goal weight.");
        setupStep = 0;
        renderSetupStep();
        return;
    }

    setupData.complete = true;
    setStorage("setupData", setupData);
    setStorage("weeklyPlan", setupData.weeklyPlan);

    weeklyPlan = setupData.weeklyPlan;

    data = {
        date: getTodayString(),
        completed: {},
        tempTasks: [],
        meals: [],
        weightHistory: [],
        fatHistory: []
    };

    saveData();

    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "flex";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";

    render();
    renderStatsPage();
    renderCaloriePage();
    autoResizeWindow();
}

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

function createExerciseTask(name = "", value = "", unit = "reps", sets = "", weight = "") {
    return { id: makeId(), name, value, unit, sets, weight };
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
        return { id: `legacy-${task}`, name: task, value: "", unit: "reps", sets: "", weight: "" };
    }
    return {
        id: task.id || makeId(),
        name: task.name || task.exercise || task.title || "Exercise",
        value: task.value || task.reps || "",
        unit: task.unit || "reps",
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
    
    if (t.value) {
        let unitDisplay = t.unit;
        if (t.unit === "reps") unitDisplay = "reps";
        else if (t.unit === "seconds") unitDisplay = "sec";
        else if (t.unit === "minutes") unitDisplay = "min";
        else if (t.unit === "hours") unitDisplay = "hr";
        parts.push(`${t.value} ${unitDisplay}`);
    }
    
    if (t.sets) parts.push(`${t.sets} sets`);
    if (t.weight) parts.push(t.weight);
    return parts.join(" • ");
}

function getAllTasks() {
    const day = getDayName();
    if (!weeklyPlan[day]) return [];
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

    focusDiv.innerHTML = `<strong>${day}</strong><br>Focus: ${weeklyPlan[day].focus}`;
    tasksDiv.innerHTML = "";

    weeklyPlan[day].tasks.forEach((task, i) => renderTaskItem(task, false, i, day));
    data.tempTasks.forEach((task, i) => renderTaskItem(task, true, i, day));

    saveData();
    checkCompleted();
    autoResizeWindow();
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
    const selectedCalories = getSelectedCalories();
    if (calorieViewMode === "weekly") {
        return selectedCalories * 7;
    } else {
        return selectedCalories;
    }
}

function getCaloriesLeftForView() {
    const target = getCalorieTargetForView();
    const eaten = getCaloriesEatenForView();
    return target - eaten;
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
    const selectedCal = getSelectedCalories();
    const mode = setupData.calorieMode || "Cutting";
    
    document.getElementById("idealWeightText").innerHTML = `${getGoalWeight()} kg`;
    document.getElementById("calorieHeightText").innerHTML = `${getHeight()} cm`;
    
    let modeText = "";
    if (mode === "Cutting") modeText = "🔥 Cutting Target";
    else if (mode === "Bulking") modeText = "💪 Bulking Target";
    else modeText = "⚖️ Maintaining Target";
    
    document.getElementById("selectedCaloriesText").innerHTML = `<strong style="color:#46eaff">${selectedCal} kcal</strong> (${modeText})`;
    
    const maintainCaloriesEl = document.getElementById("maintainCaloriesText");
    const cutCaloriesEl = document.getElementById("cutCaloriesText");
    const gainCaloriesEl = document.getElementById("gainCaloriesText");
    
    if (maintainCaloriesEl) maintainCaloriesEl.style.display = "none";
    if (cutCaloriesEl) cutCaloriesEl.style.display = "none";
    if (gainCaloriesEl) gainCaloriesEl.style.display = "none";

    const calorieBodyFatText = document.getElementById("calorieBodyFatText");
    if (calorieBodyFatText) calorieBodyFatText.innerText = `${getCurrentBodyFat()}%`;

    const calorieTargetBodyFatText = document.getElementById("calorieTargetBodyFatText");
    if (calorieTargetBodyFatText) calorieTargetBodyFatText.innerText = `${getTargetBodyFat()}%`;

    const activityBtn = document.getElementById("activityLevelBtn");
    if (activityBtn) activityBtn.innerText = `🏃 Activity: ${setupData.activityLevel || "Moderate"}`;
    
    const modeBtn = document.getElementById("calorieModeBtn");
    if (modeBtn) {
        let modeIcon = "⚖️";
        if (mode === "Cutting") modeIcon = "🔥";
        if (mode === "Bulking") modeIcon = "💪";
        modeBtn.innerText = `${modeIcon} Mode: ${mode}`;
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

    let caloriesTarget, caloriesEaten;
    
    if (calorieViewMode === "weekly") {
        caloriesTarget = selectedCal * 7;
        const weekMeals = getThisWeekMeals();
        caloriesEaten = weekMeals.reduce((total, meal) => total + meal.calories, 0);
    } else {
        caloriesTarget = selectedCal;
        caloriesEaten = getCaloriesEatenToday();
    }
    
    const caloriesLeft = caloriesTarget - caloriesEaten;
    
    document.getElementById("caloriesLeftText").innerHTML = `${caloriesLeft} kcal`;
    const eatenText = document.getElementById("caloriesEatenText");
    if (eatenText) eatenText.innerHTML = `${caloriesEaten} / ${caloriesTarget} kcal`;

    // Calculate ALL macros fresh
    const proteinTarget = getProteinTargetToday();
    const carbsTarget = getCarbsTargetToday();
    const fatTarget = getFatTargetToday();
    
    const macros = getMacroTotalsForView();
    const proteinEl = document.getElementById("proteinText");
    const carbsEl = document.getElementById("carbsText");
    const fatEl = document.getElementById("fatText");
    
    if (proteinEl) proteinEl.innerHTML = `${macros.protein} g / <strong style="color:#46eaff">${proteinTarget} g</strong>`;
    if (carbsEl) carbsEl.innerHTML = `${macros.carbs} g / <strong style="color:#46eaff">${carbsTarget} g</strong>`;
    if (fatEl) fatEl.innerHTML = `${macros.fat} g / <strong style="color:#46eaff">${fatTarget} g</strong>`;
    
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
        if (doneOverlay) doneOverlay.style.display = "flex";
    } else {
        calorieBox.classList.remove("calorie-over");
        addMealBtn.disabled = false;
        addMealBtn.classList.remove("locked-btn");
        if (frequentMealBtn) {
            frequentMealBtn.disabled = false;
            frequentMealBtn.classList.remove("locked-btn");
        }
        if (doneOverlay) doneOverlay.style.display = "none";
    }
    autoResizeWindow();
}

function removeMealByActualIndex(actualIndex) {
    if (actualIndex !== -1) data.meals.splice(actualIndex, 1);
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
    if (meal.id) return data.meals.findIndex(m => m.id === meal.id);
    return data.meals.findIndex(m => m.date === meal.date && m.time === meal.time && m.name === meal.name && m.calories === meal.calories);
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
        { id: "modalCarbs", key: "carbs", placeholder: "Carbs (g)" },
        { id: "modalFat", key: "fat", placeholder: "Fat (g)" }
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
        { id: "modalCarbs", key: "carbs", placeholder: "Carbs (g)" },
        { id: "modalFat", key: "fat", placeholder: "Fat (g)" }
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
        baseCarbs: meal.carbs || 0,
        baseFat: meal.fat || 0,
        protein: Math.round((meal.protein || 0) * quantity),
        carbs: Math.round((meal.carbs || 0) * quantity),
        fat: Math.round((meal.fat || 0) * quantity)
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

function resetModalInputs() {
    const input = document.getElementById("modalInput");
    const calorieInput = document.getElementById("modalInputCalories");
    const timeInput = document.getElementById("modalInputTime");
    const repsInput = document.getElementById("modalInputReps");
    const setsInput = document.getElementById("modalInputSets");
    const weightInput = document.getElementById("modalInputWeight");
    const quantityInput = document.getElementById("modalInputQuantity");
    const unitSelect = document.getElementById("modalInputUnit");
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
    
    if (unitSelect) {
        unitSelect.style.display = "none";
        unitSelect.value = "reps";
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
    const unitSelect = document.getElementById("modalInputUnit");
    
    if (repsInput) {
        repsInput.style.display = "block";
        repsInput.type = "number";
        repsInput.min = "0";
        repsInput.placeholder = "Value (reps/time)";
        repsInput.value = t.value || "";
    }
    
    if (unitSelect) {
        unitSelect.style.display = "block";
        unitSelect.value = t.unit || "reps";
        unitSelect.innerHTML = `
            <option value="reps">Reps</option>
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
        `;
    }
    
    if (setsInput) {
        setsInput.style.display = "block";
        setsInput.type = "number";
        setsInput.min = "0";
        setsInput.placeholder = "Sets (optional)";
        setsInput.value = t.sets || "";
    }
    
    if (weightInput) {
        weightInput.style.display = "block";
        weightInput.type = "text";
        weightInput.placeholder = "Weight optional, e.g. 5kg";
        weightInput.value = t.weight || "";
    }
}

function readExerciseModal() {
    const unitSelect = document.getElementById("modalInputUnit");
    return {
        id: makeId(),
        name: document.getElementById("modalInput").value.trim(),
        value: document.getElementById("modalInputReps")?.value.trim() || "",
        unit: unitSelect ? unitSelect.value : "reps",
        sets: document.getElementById("modalInputSets")?.value.trim() || "",
        weight: document.getElementById("modalInputWeight")?.value.trim() || ""
    };
}

function readMacroInputs() {
    const protein = parseFloat(document.getElementById("modalProtein")?.value) || 0;
    const carbs = parseFloat(document.getElementById("modalCarbs")?.value) || 0;
    const fat = parseFloat(document.getElementById("modalFat")?.value) || 0;
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
        data.weightHistory.push({ date: getTodayString(), weight });
        setupData.currentWeight = weight;
        setStorage("setupData", setupData);
        saveData();
        closeModal();
        refreshStatsAndHistoryPages();
        return;
    }
    
    if (modalMode === "editWeight") {
        const weight = Number(input);
        if (!Number.isFinite(weight) || weight <= 0) {
            showModalError("Enter a valid weight.", "modalInput");
            return;
        }
        data.weightHistory[window.editingWeightIndex].weight = weight;
        if (window.editingWeightIndex === data.weightHistory.length - 1) {
            setupData.currentWeight = weight;
            setStorage("setupData", setupData);
        }
        saveData();
        closeModal();
        refreshStatsAndHistoryPages();
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
            data.meals[actualIndex].baseCarbs = m.carbs;
            data.meals[actualIndex].baseFat = m.fat;
            data.meals[actualIndex].protein = Math.round(m.protein * quantity);
            data.meals[actualIndex].carbs = Math.round(m.carbs * quantity);
            data.meals[actualIndex].fat = Math.round(m.fat * quantity);
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
            frequentMeals[index].carbs = m.carbs;
            frequentMeals[index].fat = m.fat;
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
        if (!data.fatHistory) data.fatHistory = [];
        data.fatHistory.push({ date: getTodayString(), bodyFat });
        setupData.bodyFat = bodyFat;
        setStorage("setupData", setupData);
        saveData();
        refreshStatsAndHistoryPages();
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
        if (window.editingBodyFatIndex === data.fatHistory.length - 1) {
            setupData.bodyFat = bodyFat;
            setStorage("setupData", setupData);
        }
        saveData();
        closeModal();
        refreshStatsAndHistoryPages();
        renderCaloriePage();
        return;
    }
    
    saveData();
    closeModal();
    render();
}

function renderStatsPage() {
    document.getElementById("dateText").innerText = getTodayString();
    
    const latestWeight = data.weightHistory?.length > 0 ? data.weightHistory[data.weightHistory.length - 1].weight : setupData.currentWeight;
    document.getElementById("weightText").innerText = latestWeight ? `${latestWeight} kg` : "No weight yet";
    
    document.getElementById("nameText").innerText = setupData.name || "Unknown";
    document.getElementById("heightText").innerText = setupData.height ? `${setupData.height} cm` : "Unknown";
    document.getElementById("goalWeightText").innerText = setupData.goalWeight ? `${setupData.goalWeight} kg` : "Unknown";
    const latestBodyFat = data.fatHistory?.length > 0 ? data.fatHistory[data.fatHistory.length - 1].bodyFat : setupData.bodyFat;
    document.getElementById("bodyFatText").innerText = latestBodyFat ? latestBodyFat + "%" : (setupData.sex === "female" ? "22%" : "15%");
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
    const weightEntries = getWeightHistoryEntries();
    renderHistoryList({
        entries: weightEntries,
        list,
        emptyText: "No weight entries yet. Add your first weight above.",
        limit: HISTORY_PREVIEW_LIMIT,
        valueLabel: entry => `${entry.weight} kg`,
        editName: "editWeight",
        removeName: "removeWeight"
    });

    const fatList = document.getElementById("fatHistoryList");
    fatList.innerHTML = "";
    const fatEntries = getFatHistoryEntries();
    renderHistoryList({
        entries: fatEntries,
        list: fatList,
        emptyText: "No body fat entries yet. Add your first entry above.",
        limit: HISTORY_PREVIEW_LIMIT,
        valueLabel: entry => `${entry.bodyFat}%`,
        editName: "editBodyFat",
        removeName: "removeBodyFat"
    });

    drawWeightChart();
    drawFatChart();
    updateRehabStatusText();
    autoResizeWindow();
}

function getWeightHistoryEntries() {
    if (!data.weightHistory || data.weightHistory.length === 0) return [];
    return data.weightHistory.map((entry, originalIndex) => ({ ...entry, originalIndex }));
}

function getFatHistoryEntries() {
    if (!data.fatHistory || data.fatHistory.length === 0) return [];
    return data.fatHistory.map((entry, originalIndex) => ({ ...entry, originalIndex }));
}

function renderHistoryList({ entries, list, emptyText, limit = null, valueLabel, editName, removeName }) {
    if (entries.length === 0) {
        list.innerHTML = `<div class="task-row"><span>${emptyText}</span></div>`;
        return;
    }

    const visibleEntries = limit ? entries.slice(-limit) : entries;
    visibleEntries.forEach(entry => {
        const div = document.createElement("div");
        div.className = "task-row";
        const actions = `
            <div class="task-actions">
                <button onclick="${editName}(${entry.originalIndex})">Edit</button>
                <button onclick="${removeName}(${entry.originalIndex})">Remove</button>
            </div>
        `;
        div.innerHTML = `
            <span>${entry.date}: ${valueLabel(entry)}</span>
            ${actions}
        `;
        list.appendChild(div);
    });
}

function renderWeightHistoryPage() {
    const list = document.getElementById("weightFullHistoryList");
    if (!list) return;
    updateHistoryBackLabels();
    list.innerHTML = "";
    renderHistoryList({
        entries: getWeightHistoryEntries(),
        list,
        emptyText: "No weight entries yet. Add your first weight below.",
        valueLabel: entry => `${entry.weight} kg`,
        editName: "editWeight",
        removeName: "removeWeight"
    });
    drawHistoryChart("weightHistoryChart", getWeightHistoryEntries(), "weight", "kg", "No weight data");
    autoResizeWindow();
}

function renderBodyFatHistoryPage() {
    const list = document.getElementById("bodyFatFullHistoryList");
    if (!list) return;
    updateHistoryBackLabels();
    list.innerHTML = "";
    renderHistoryList({
        entries: getFatHistoryEntries(),
        list,
        emptyText: "No body fat entries yet. Add your first entry below.",
        valueLabel: entry => `${entry.bodyFat}%`,
        editName: "editBodyFat",
        removeName: "removeBodyFat"
    });
    drawHistoryChart("bodyFatHistoryChart", getFatHistoryEntries(), "bodyFat", "%", "No body fat data");
    autoResizeWindow();
}

function updateHistoryBackLabels() {
    document.querySelectorAll("#weightHistoryPage button[onclick='goToStats()'], #bodyFatHistoryPage button[onclick='goToStats()']")
        .forEach(button => {
            button.innerText = "← Back to Player Status";
        });
}

function refreshStatsAndHistoryPages() {
    renderStatsPage();
    if (document.getElementById("weightHistoryPage")?.style.display === "flex") {
        renderWeightHistoryPage();
    }
    if (document.getElementById("bodyFatHistoryPage")?.style.display === "flex") {
        renderBodyFatHistoryPage();
    }
}

function toggleWeightHistoryView() {
    hideAllPages();
    document.getElementById("weightHistoryPage").style.display = "flex";
    renderWeightHistoryPage();
}

function toggleFatHistoryView() {
    hideAllPages();
    document.getElementById("bodyFatHistoryPage").style.display = "flex";
    renderBodyFatHistoryPage();
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
    const latestWeight = data.weightHistory.length ? data.weightHistory[data.weightHistory.length - 1].weight : setupData.currentWeight;
    setupData.currentWeight = latestWeight;
    setStorage("setupData", setupData);
    saveData();
    refreshStatsAndHistoryPages();
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
    const latestBodyFat = data.fatHistory.length ? data.fatHistory[data.fatHistory.length - 1].bodyFat : setupData.bodyFat;
    setupData.bodyFat = latestBodyFat;
    setStorage("setupData", setupData);
    saveData();
    refreshStatsAndHistoryPages();
    renderCaloriePage();
}

function enableDragScroll(slider) {
    if (!slider || slider.dataset.dragEnabled) return;
    slider.dataset.dragEnabled = "true";
    let isDown = false, startX, scrollLeft;
    slider.addEventListener('mousedown', (e) => { isDown = true; startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; });
    slider.addEventListener('mouseleave', () => { isDown = false; });
    slider.addEventListener('mouseup', () => { isDown = false; });
    slider.addEventListener('mousemove', (e) => { if (!isDown) return; e.preventDefault(); slider.scrollLeft = scrollLeft - (e.pageX - slider.offsetLeft - startX); });
}

function drawHistoryChart(canvasId, entries, valueKey, suffix, emptyText, hideWhenEmpty = false) {
    const canvas = document.getElementById(canvasId);
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

    const points = [...entries].sort((a, b) => new Date(a.date.split('/').reverse().join('-')) - new Date(b.date.split('/').reverse().join('-')));

    if (points.length === 0) {
        if (hideWhenEmpty) {
            parentBox.style.display = "none";
            return;
        }
        parentBox.style.display = "";
        const visibleWidth = scrollWrapper.clientWidth || 200;
        canvas.width = visibleWidth;
        canvas.height = canvas.clientHeight || 150;
        canvas.style.minWidth = canvas.width + "px";
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "10px Arial";
        ctx.fillText(emptyText, canvas.width / 2 - 40, canvas.height / 2);
        return;
    }

    parentBox.style.display = "";
    const padding = 25, rightBuffer = 50;
    const visibleWidth = scrollWrapper.clientWidth || 200;
    const pointSpacing = points.length === 1 ? (visibleWidth - padding * 2) / 2 : (visibleWidth - padding * 2) / 4;
    const totalRequiredWidth = padding + (Math.max(0, points.length - 1) * pointSpacing) + rightBuffer;
    canvas.width = Math.max(visibleWidth, totalRequiredWidth);
    canvas.height = canvas.clientHeight || 150;
    canvas.style.minWidth = canvas.width + "px";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const chartHeight = canvas.height - padding * 2;
    const values = points.map(point => point[valueKey]);
    const minValue = Math.min(...values) - 1;
    const maxValue = Math.max(...values) + 1;

    function x(i) {
        return points.length === 1 ? padding + pointSpacing : padding + (i * pointSpacing);
    }
    function y(value) {
        return padding + ((maxValue - value) / (maxValue - minValue)) * chartHeight;
    }

    if (points.length > 1) {
        ctx.strokeStyle = "#46eaff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((point, i) => {
            if (i === 0) ctx.moveTo(x(i), y(point[valueKey]));
            else ctx.lineTo(x(i), y(point[valueKey]));
        });
        ctx.stroke();
    }

    points.forEach((point, i) => {
        const value = point[valueKey];
        ctx.beginPath();
        ctx.arc(x(i), y(value), 5, 0, Math.PI * 2);
        ctx.fillStyle = "#46eaff";
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px Arial";
        ctx.fillText(`${value}${suffix}`, x(i) - 15, y(value) - 8);

        if (points.length > 1) {
            ctx.fillStyle = "#b8c7d9";
            ctx.font = "8px Arial";
            const dateParts = point.date.split('/');
            const shortDate = `${dateParts[0]}/${dateParts[1]}`;
            ctx.fillText(shortDate, x(i) - 12, y(value) + 12);
        }
    });

    if (scrollWrapper.scrollWidth > scrollWrapper.clientWidth) {
        scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
    }
}

function drawWeightChart() {
    drawHistoryChart("weightChart", data.weightHistory || [], "weight", "kg", "No weight data");
}

function drawFatChart() {
    drawHistoryChart("fatChart", data.fatHistory || [], "bodyFat", "%", "No body fat data", true);
}

function updateTimer() {
    checkNewDay();
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const diff = midnight - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    timerDiv.innerText = `Time Left: ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getPainRange(pain) {
    if (pain <= 3) return "low";
    if (pain <= 6) return "medium";
    return "high";
}

function getRecoveryDays(bodyPart, pain) {
    const range = getPainRange(pain);
    const recoveryMap = {
        low: { neck: 3, shoulder: 5, arm: 4, back: 5, hip: 5, knee: 5, ankle: 5, shin: 7 },
        medium: { neck: 7, shoulder: 10, arm: 7, back: 10, hip: 10, knee: 10, ankle: 10, shin: 14 },
        high: { neck: 14, shoulder: 14, arm: 14, back: 14, hip: 14, knee: 14, ankle: 14, shin: 21 }
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
        if (!data.tempTasks.includes(rehabTask)) data.tempTasks.push(rehabTask);
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
    rehabData = { active: false, bodyPart: "", pain: 0, recoveryUntil: "", tasks: [], needsReview: false };
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
    rehabData = { active: true, bodyPart, pain, recoveryUntil: getRecoveryDate(days), tasks, needsReview: false };
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
            <div class="stat-box"><p><strong>Select injured area:</strong></p><p>Pain scale: 1 = barely there, 10 = go-to-hospital type injury.</p></div>
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
            <div class="stat-box"><p><strong>Recovery date reached.</strong></p><p>Area: ${rehabData.bodyPart}</p><p>Last pain rating: ${rehabData.pain}/10</p><p>Are you fully healed, or do you need another rehab cycle?</p></div>
            <button class="page-btn" onclick="clearRehabProtocol()">I'm fully healed</button>
            <button class="page-btn" onclick="selectRehabBodyPart('${rehabData.bodyPart}')">Re-check pain level</button>
        `;
        autoResizeWindow();
        return;
    }
    const taskHtml = rehabData.tasks.map(task => `<div class="rehab-task-preview">${task}</div>`).join("");
    content.innerHTML = `
        <div class="stat-box"><p><strong>Active Rehab Protocol</strong></p><p><strong>Area:</strong> ${rehabData.bodyPart}</p><p><strong>Pain:</strong> ${rehabData.pain}/10</p><p><strong>Estimated recovery until:</strong> ${rehabData.recoveryUntil}</p></div>
        ${rehabData.pain >= 7 ? `<div class="rehab-warning">Pain is high. These are gentle recovery tasks only. If pain is severe, worsening, swollen, unstable, numb, or affecting normal movement, consider seeing a doctor or physio.</div>` : ""}
        <h2>Rehab Tasks Added</h2>${taskHtml}
        <button class="page-btn danger-btn" onclick="clearRehabProtocol()">End Rehab Protocol</button>
    `;
    autoResizeWindow();
}

function selectRehabBodyPart(bodyPart) {
    const content = document.getElementById("rehabContent");
    content.innerHTML = `
        <div class="stat-box"><p><strong>Selected:</strong> ${bodyPart}</p><p>Rate pain from 1–10.</p><p>1 = barely there. 10 = go-to-hospital type injury.</p></div>
        <div class="rehab-option-grid">${[1,2,3,4,5,6,7,8,9,10].map(num => `<button class="rehab-option-btn" onclick="confirmRehabPain('${bodyPart}', ${num})">${num}</button>`).join("")}</div>
        <button class="page-btn" onclick="renderRehabPage()">← Back</button>
    `;
    autoResizeWindow();
}

function confirmRehabPain(bodyPart, pain) {
    const days = getRecoveryDays(bodyPart, pain);
    const tasks = getRehabTasks(bodyPart, pain);
    const taskHtml = tasks.map(task => `<div class="rehab-task-preview">${task}</div>`).join("");
    const content = document.getElementById("rehabContent");
    content.innerHTML = `
        <div class="stat-box"><p><strong>Area:</strong> ${bodyPart}</p><p><strong>Pain:</strong> ${pain}/10</p><p><strong>Estimated recovery:</strong> ${days} days</p><p><strong>Recovery until:</strong> ${getRecoveryDate(days)}</p></div>
        ${pain >= 7 ? `<div class="rehab-warning">Pain is high. This should stay very gentle. If this feels serious, unstable, sharp, swollen, numb, or unusually painful, consider seeing a doctor or physio.</div>` : ""}
        <h2>Exercises to be added</h2>${taskHtml}
        <button class="page-btn" onclick="startRehabProtocol('${bodyPart}', ${pain})">Start Rehab Protocol</button>
        <button class="page-btn" onclick="selectRehabBodyPart('${bodyPart}')">← Change Pain Rating</button>
    `;
    autoResizeWindow();
}

function updateRehabStatusText() {
    const rehabStatusText = document.getElementById("rehabStatusText");
    if (!rehabStatusText) return;
    if (!rehabData.active) { rehabStatusText.innerText = "No active rehab protocol"; return; }
    if (rehabData.needsReview) { rehabStatusText.innerText = `${rehabData.bodyPart} needs review`; return; }
    rehabStatusText.innerText = `${rehabData.bodyPart} rehab active until ${rehabData.recoveryUntil}`;
}

function hideAllPages() {
    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "none";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("weightHistoryPage").style.display = "none";
    document.getElementById("bodyFatHistoryPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("rehabPage").style.display = "none";
    const frequentPage = document.getElementById("frequentMealPage");
    if (frequentPage) frequentPage.style.display = "none";
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
    const confirmed = confirm("This will delete EVERYTHING: registration, weekly plan, tasks, meals, weights, and progress. Are you sure?");
    if (!confirmed) return;
    localStorage.removeItem("soloSystem_public_setupData");
    localStorage.removeItem("soloSystem_public_weeklyPlan");
    localStorage.removeItem("soloSystem_public_questData");
    setupStep = 0;
    setupData = { complete: false, name: "", height: "", currentWeight: "", goalWeight: "", bodyFat: "", targetBodyFat: "", age: "", sex: "male", activityLevel: "Moderate", calorieMode: "Cutting", weeklyPlan: {} };
    weeklyPlan = defaultWeeklyPlan;
    data = { date: getTodayString(), completed: {}, tempTasks: [], meals: [], weightHistory: [], fatHistory: [] };
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("weightHistoryPage").style.display = "none";
    document.getElementById("bodyFatHistoryPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("tasksPage").style.display = "none";
    document.getElementById("setupOverlay").style.display = "flex";
    renderSetupStep();
    autoResizeWindow();
}

const rehabProtocols = {
    neck: { low: ["Neck rotations — 2 x 8 each side", "Chin tucks — 2 x 10", "Upper trap stretch — 30s each side"], medium: ["Gentle chin tucks — 2 x 8", "Neck isometrics — 3 x 5s each direction", "Avoid heavy overhead lifting"], high: ["Rest neck from loading", "Gentle pain-free movement only", "Consider seeing a doctor or physio"] },
    shoulder: { low: ["Band external rotations — 2 x 12", "Wall slides — 2 x 10", "Scapular squeezes — 2 x 12"], medium: ["Scapular squeezes — 2 x 10", "Pendulum swings — 2 x 30s", "Avoid pressing movements"], high: ["Avoid shoulder loading", "Gentle pendulum swings only", "Consider seeing a doctor or physio"] },
    arm: { low: ["Wrist circles — 2 x 10", "Light forearm stretch — 30s each", "Gentle bicep/tricep mobility — 2 x 10"], medium: ["Gentle arm mobility — 2 x 10", "Avoid curls and pressing", "Light stretching only"], high: ["Rest arm from loading", "Pain-free range of motion only", "Consider seeing a doctor or physio"] },
    back: { low: ["Cat-cow — 2 x 10", "Child's pose — 45s", "Glute bridges — 2 x 12"], medium: ["Cat-cow — 2 x 8", "Dead bugs — 2 x 8 each", "Avoid heavy bending/lifting"], high: ["Avoid loaded bending", "Gentle walking only if pain-free", "Consider seeing a doctor or physio"] },
    hip: { low: ["Hip circles — 2 x 10 each", "Glute bridges — 3 x 12", "Couch stretch — 30s each"], medium: ["Glute bridges — 2 x 10", "Hip flexor stretch — 30s each", "Avoid sprinting and deep lunges"], high: ["Avoid hard lower-body training", "Gentle pain-free mobility only", "Consider seeing a doctor or physio"] },
    knee: { low: ["Quad sets — 3 x 10", "Glute bridges — 3 x 12", "Step-downs — 2 x 8 each"], medium: ["Quad sets — 3 x 10", "Glute bridges — 2 x 10", "Avoid jumping and sprinting"], high: ["Avoid knee loading", "Gentle pain-free movement only", "Consider seeing a doctor or physio"] },
    ankle: { low: ["Ankle circles — 2 x 10 each direction", "Calf raises — 3 x 12", "Single-leg balance — 3 x 20s each"], medium: ["Ankle circles — 2 x 10", "Seated calf raises — 2 x 12", "Avoid jumping and running"], high: ["Avoid ankle loading", "Gentle ankle movement only", "Consider seeing a doctor or physio"] },
    shin: { low: ["Tibialis raises — 2 x 12", "Calf stretch — 30s each", "Low-impact bike — 10 mins"], medium: ["Tibialis raises — 2 x 10", "Calf stretch — 30s each", "Avoid running and jumping"], high: ["Avoid impact training", "Low-impact movement only if pain-free", "Consider seeing a doctor or physio"] }
};

document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
    if (e.key === "Enter" && document.getElementById("inputModal").style.display === "flex") submitModal();
});

setInterval(() => { if (setupData.complete) updateTimer(); }, 1000);

if (!setupData.complete) startSetupIfNeeded();
else {
    document.getElementById("setupOverlay").style.display = "none";
    document.getElementById("tasksPage").style.display = "flex";
    document.getElementById("statsPage").style.display = "none";
    document.getElementById("weightHistoryPage").style.display = "none";
    document.getElementById("bodyFatHistoryPage").style.display = "none";
    document.getElementById("caloriePage").style.display = "none";
    document.getElementById("rehabPage").style.display = "none";
    checkRehabStatus();
    render();
    updateTimer();
}

function forceProteinUpdate() {
    const mode = setupData.calorieMode || "Cutting";
    const activity = setupData.activityLevel || "Moderate";
    const bodyFat = getCurrentBodyFat();
    const weight = getCurrentWeight();
    
    let leanMass = weight;
    if (bodyFat > 0 && bodyFat < 50) {
        leanMass = weight * (1 - bodyFat / 100);
    }
    
    const activityMap = {
        "Sedentary": 1.6,
        "Light": 1.8,
        "Moderate": 2.0,
        "Active": 2.2
    };
    let baseProtein = activityMap[activity] || 2.0;
    
    let modeMultiplier = 1.0;
    if (mode === "Cutting") modeMultiplier = 1.2;
    if (mode === "Bulking") modeMultiplier = 1.3;
    
    const proteinTarget = Math.round(leanMass * baseProtein * modeMultiplier);
    
    // Direct DOM update
    const proteinEl = document.getElementById("proteinText");
    if (proteinEl) {
        proteinEl.innerHTML = `0 g / <strong style="color:#46eaff">${proteinTarget} g</strong>`;
        console.log("Direct update - Protein set to:", proteinTarget);
        return proteinTarget;
    } else {
        console.error("proteinText element NOT FOUND in DOM!");
        return null;
    }
}

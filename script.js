function tokenize(text) {
    const tokens = [];
    let current = "";

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === " ") {
            if (current) {
                tokens.push(current);
                current = "";
            }
            tokens.push(" ");
        }
        else if (/[.,!?;:]/.test(ch)) {
            if (current) {
                tokens.push(current);
                current = "";
            }
            tokens.push(ch);
        }
        else {
            current += ch;
        }
    }

    if (current) tokens.push(current);

    return tokens;
}

function parseWhitelist(value) {
    if (!value) return [];
    return value
        .split(/[,;\n]/) 
        .map(w => w.trim())
        .filter(w => w.length > 0);
}

function diffWords(sampleTokens, userTokens) {
    const n = sampleTokens.length;
    const m = userTokens.length;

    const dp = Array(n + 1)
        .fill(null)
        .map(() => Array(m + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            if (sampleTokens[i - 1] === userTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    let i = n, j = m;
    const steps = [];

    while (i > 0 || j > 0) {
        if (
            i > 0 &&
            j > 0 &&
            sampleTokens[i - 1] === userTokens[j - 1] &&
            dp[i][j] === dp[i - 1][j - 1] + 1
        ) {
            steps.push({
                type: "match",
                sample: sampleTokens[i - 1],
                user: userTokens[j - 1]
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            steps.push({
                type: "extra",
                sample: null,
                user: userTokens[j - 1]
            });
            j--;
        } else if (i > 0) {
            steps.push({
                type: "missing",
                sample: sampleTokens[i - 1],
                user: null
            });
            i--;
        }
    }

    return steps.reverse();
}

function trimTrailingSpaceDiff(steps) {
    let i = steps.length - 1;
    while (i >= 0) {
        const st = steps[i];
        const isTrailingSpace =
            (st.type === "missing" && st.sample === " ") ||
            (st.type === "extra" && st.user === " ");
        if (isTrailingSpace) {
            steps.pop();
            i--;
        } else {
            break;
        }
    }
    return steps;
}

function renderToken(token, cssClass) {
    if (token === " ") {
        return `<span class="word ${cssClass}">&nbsp;</span>`;
    }
    return `<span class="word ${cssClass}">${token}</span>`;
}

function readableToken(token) {
    if (token === " ") return "space";
    if (/^[.,!?;:]$/.test(token)) return `symbol "${token}"`;
    return token;
}

document.addEventListener("DOMContentLoaded", () => {

    const setupScreen = document.getElementById("setupScreen");
    const practiceScreen = document.getElementById("practiceScreen");

    const startButton = document.getElementById("startButton");
    const checkButton = document.getElementById("checkButton");
    const restartButton = document.getElementById("restartButton");

    const whitelistInput = document.getElementById("whitelistInput");
    const sampleTextArea = document.getElementById("sampleText");
    const userTextArea = document.getElementById("userText");

    const summaryEl = document.getElementById("summary");
    const sampleHighlightedEl = document.getElementById("sampleHighlighted");
    const errorListEl = document.getElementById("errorList");

    let whitelistSet = new Set();
    let whitelistArray = [];

    const suggestionBox = document.createElement("div");
    suggestionBox.id = "quickSuggestions";
    Object.assign(suggestionBox.style, {
        position: "absolute",
        background: "#111827",
        border: "1px solid #374151",
        borderRadius: "0.5rem",
        padding: "4px 0",
        fontSize: "13px",
        maxHeight: "180px",
        overflowY: "auto",
        display: "none",
        zIndex: "9999",
        boxShadow: "0 10px 25px rgba(0,0,0,0.6)",
        minWidth: "160px"
    });
    document.body.appendChild(suggestionBox);

    let suggestionVisible = false;
    let suggestionItems = [];
    let activeSuggestionIndex = -1;

    function hideSuggestions() {
        suggestionBox.style.display = "none";
        suggestionVisible = false;
        suggestionItems = [];
        activeSuggestionIndex = -1;
    }

    function showSuggestions(candidates) {
        suggestionBox.innerHTML = "";
        suggestionItems = candidates.map((token, index) => {
            const item = document.createElement("div");
            item.textContent = token;
            Object.assign(item.style, {
                padding: "4px 10px",
                cursor: "pointer",
                color: "#e5e7eb"
            });
            item.dataset.index = index.toString();
            item.addEventListener("mouseenter", () => {
                setActiveSuggestion(index);
            });
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                applySuggestion(index);
            });
            suggestionBox.appendChild(item);
            return { token, element: item };
        });

        if (suggestionItems.length > 0) {
            activeSuggestionIndex = 0;
            setActiveSuggestion(0);

            const rect = userTextArea.getBoundingClientRect();
            suggestionBox.style.left = rect.left + window.scrollX + "px";
            suggestionBox.style.top = rect.bottom + window.scrollY + "px";
            suggestionBox.style.display = "block";
            suggestionVisible = true;
        } else {
            hideSuggestions();
        }
    }

    function setActiveSuggestion(index) {
        activeSuggestionIndex = index;
        suggestionItems.forEach((item, i) => {
            if (i === index) {
                item.element.style.background = "#1f2937";
            } else {
                item.element.style.background = "transparent";
            }
        });
    }

    function updateSuggestions() {
        const value = userTextArea.value;
        const cursorPos = userTextArea.selectionStart;

        const before = value.slice(0, cursorPos);
        const lastBracket = before.lastIndexOf("[");

        if (lastBracket === -1) {
            hideSuggestions();
            return;
        }

        const fragment = before.slice(lastBracket, cursorPos); 
        if (/\s|\]/.test(fragment.slice(1))) {
            hideSuggestions();
            return;
        }

        const inner = fragment.slice(1); 
        const candidates = whitelistArray.filter(w =>
            w.startsWith("[" + inner)
        );

        if (candidates.length === 0) {
            hideSuggestions();
            return;
        }

        showSuggestions(candidates);
    }

    function applySuggestion(index) {
        if (!suggestionVisible || index < 0 || index >= suggestionItems.length) return;

        const selected = suggestionItems[index].token;

        const value = userTextArea.value;
        const cursorPos = userTextArea.selectionStart;
        const before = value.slice(0, cursorPos);
        const after = value.slice(cursorPos);

        const lastBracket = before.lastIndexOf("[");
        if (lastBracket === -1) return;

        const newBefore = before.slice(0, lastBracket) + selected + " ";
        const newCursorPos = newBefore.length;

        userTextArea.value = newBefore + after;
        userTextArea.selectionStart = newCursorPos;
        userTextArea.selectionEnd = newCursorPos;

        hideSuggestions();
    }

    startButton.addEventListener("click", () => {
        const wl = parseWhitelist(whitelistInput.value);
        whitelistArray = Array.from(new Set(["[kw]", "[KW]", ...wl]));
        whitelistSet = new Set(whitelistArray);

        setupScreen.style.display = "none";
        practiceScreen.style.display = "block";

        userTextArea.value = "";
        sampleHighlightedEl.innerHTML = "";
        errorListEl.innerHTML = "";
        summaryEl.innerHTML = "";
        restartButton.style.display = "none";
        hideSuggestions();
    });

    userTextArea.addEventListener("input", () => {
        updateSuggestions();
    });

    userTextArea.addEventListener("keydown", (e) => {
        if (!suggestionVisible) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (suggestionItems.length === 0) return;
            const next = (activeSuggestionIndex + 1) % suggestionItems.length;
            setActiveSuggestion(next);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (suggestionItems.length === 0) return;
            const prev =
                (activeSuggestionIndex - 1 + suggestionItems.length) %
                suggestionItems.length;
            setActiveSuggestion(prev);
        } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            applySuggestion(activeSuggestionIndex);
        } else if (e.key === "Escape") {
            e.preventDefault();
            hideSuggestions();
        }
    });

    userTextArea.addEventListener("blur", () => {
        setTimeout(hideSuggestions, 150);
    });

    checkButton.addEventListener("click", () => {
        hideSuggestions();

        const sampleTokens = tokenize(sampleTextArea.value);
        const userTokens = tokenize(userTextArea.value);

        let steps = diffWords(sampleTokens, userTokens);
        steps = trimTrailingSpaceDiff(steps);

        let sampleHtml = "";
        let errors = 0;
        let missingCount = 0;
        let extraCount = 0;

        let logicalPos = 0;

        const errorMessages = [];

        steps.forEach(step => {
            const sTok = step.sample;
            const uTok = step.user;

            const isSampleWL = sTok && whitelistSet.has(sTok);
            const isUserWL = uTok && whitelistSet.has(uTok);

            if (step.type === "match") {
                if (sTok && sTok !== " ") logicalPos++;

                const cls = isSampleWL ? "whitelisted" : "correct";
                sampleHtml += renderToken(sTok, cls) + " ";
            }

            else if (step.type === "missing") {
                if (sTok && sTok !== " ") logicalPos++;

                if (isSampleWL) {
                    sampleHtml += renderToken(sTok, "whitelisted") + " ";
                } else {
                    errors++;
                    missingCount++;
                    sampleHtml += renderToken(sTok, "missing") + " ";
                    errorMessages.push(
                        `Missing token at position ${logicalPos}: expected "<b>${readableToken(sTok)}</b>".`
                    );
                }
            }

            else if (step.type === "extra") {
                if (uTok && uTok !== " ") logicalPos++;

                if (!isUserWL) {
                    errors++;
                    extraCount++;
                    errorMessages.push(
                        `Extra token at position ${logicalPos}: got "<b>${readableToken(uTok)}</b>".`
                    );
                }
            }
        });

        sampleHighlightedEl.innerHTML = sampleHtml.trim();

        summaryEl.innerHTML = `
            Total tokens: ${sampleTokens.length} |
            Your tokens: ${userTokens.length} |
            Errors: <b>${errors}</b> (missing: ${missingCount}, extra: ${extraCount})
        `;

        errorListEl.innerHTML = "";
        if (errors === 0) {
            errorListEl.innerHTML = "<li>No errors. Excellent!</li>";
        } else {
            errorMessages.forEach(msg => {
                const li = document.createElement("li");
                li.innerHTML = msg;
                errorListEl.appendChild(li);
            });
        }

        restartButton.style.display = "inline-block";
    });
    restartButton.addEventListener("click", () => {
        userTextArea.value = "";
        sampleHighlightedEl.innerHTML = "";
        errorListEl.innerHTML = "";
        summaryEl.innerHTML = "";
        restartButton.style.display = "none";
        hideSuggestions();

        practiceScreen.style.display = "none";
        setupScreen.style.display = "block";
    });

});

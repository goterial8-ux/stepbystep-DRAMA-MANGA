import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = Number(process.env.PORT) || 3000;

// Initialize GoogleGenAI client using Vertex AI
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "True" || process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

let ai: GoogleGenAI | null = null;

if (project && useVertex) {
  ai = new GoogleGenAI({
    vertexai: {
      project: project,
      location: location
    } as any
  });
  console.log("Initialized GoogleGenAI with Vertex AI.");
  console.log("Vertex project:", project);
  console.log("Vertex location:", location);
} else {
  console.error("Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION for Vertex AI.");
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasApiKey: !!ai,
    time: new Date().toISOString(),
  });
});

// Helper function to extract text and handle errors with fallback logic
async function generateText(prompt: string, systemInstruction?: string, model: string = "gemini-3-flash-preview", thinkingLevel?: string): Promise<string> {
  if (!ai) {
    throw new Error("Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION config for Vertex AI.");
  }
  
  const fallbackChain = ["gemini-3-flash-preview", "gemini-2.5-flash"];
  // If the requester explicitly passed a model that is not our 3-flash default, use it as priority 1, then fallback chain
  const modelsToTry = [...new Set([model, ...fallbackChain])];

  let lastError: any = null;

  for (const currentModel of modelsToTry) {
    try {
      console.log(`[Vertex AI] Trying model: ${currentModel}`);
      const config: any = {};
      
      // Determine default language instruction based on prompt cues or explicit requests
      const isEnglishRequested = prompt.toLowerCase().includes("english") || 
                                 prompt.toLowerCase().includes("japanese name") || 
                                 (systemInstruction && systemInstruction.toLowerCase().includes("english"));
      
      const languageInstruction = isEnglishRequested
        ? "STRICT LANGUAGE RULE: All responses, reports, scenario items, and final scripts MUST be written in English. Character names must be Japanese."
        : "ОБЯЗАТЕЛЬНОЕ УСЛОВИЕ: Все ответы, отчеты, сценарии и любые другие тексты должны быть написаны на русском языке (если специально не запрошен английский).";
      
      let finalSystemInstruction = systemInstruction ? `${systemInstruction}\n\n${languageInstruction}` : languageInstruction;
      
      // Flash Pro Reasoning Emulator Activation!
      if (currentModel.includes("flash")) {
        finalSystemInstruction += `
\n==================================================
FLASH PRO REASONING EMULATOR (HIGH THINKING ACTIVE)
==================================================
To simulate Gemini 3.1 Pro premium logical planning, rule tracking, and deep long-form writing capabilities, you MUST run a deep mental thread before outputting the final content.
You MUST format your output with a clean, detailed <thought> block on the very first line of your response.

Inside the <thought> block, explicitly list in English or Russian:
1. TARGET GOAL & LANGUAGE AUDIT (English with Japanese names, Russian, etc.)
2. STRICT BANS CHECK: No adjective bloat, no flowery metaphors, first-person "I" active narrator (not passive), sibling protective loyalty and cynical/protective emotion.
3. LOGICAL CONTINUITY: Outline of the exact steps/sections to satisfy.
4. HIGH-DENSITY WRITING CONTRACT: This part has a STRICT target of twelve thousand (12,000) to fourteen thousand (14,000) characters including spaces. Detail how you will write extremely slow-burn, hyper-detailed, high-tension descriptions of actions, thoughts, and technical details (hacking steps, toxic mixtures, corporate battles) to ensure the output is massive and fully hits the target without any fluff.
5. SELF-QA REFINEMENT: Mentally preview your narrative, identify and fix any weak sentences or default clichés.

Example format:
<thought>
[Your comprehensive reasoning process and self-evaluation steps go here]
</thought>
[Requested content, beginning with the expected markdown tags like ### STAGE OUTPUT or ### SCRIPT_OUTPUT_START]

CRITICAL WARNING: You must close the </thought> block BEFORE writing your main response. NEVER wrap your main response (like ### SCRIPT_OUTPUT_START) inside the <thought> tag! Write in high-detail, deep slow-burn style to easily reach the 12,000+ characters target length.
`;
      }

      config.systemInstruction = finalSystemInstruction;
      
      if (thinkingLevel && currentModel.includes("gemini-3") && currentModel.includes("pro")) {
        config.thinkingConfig = { thinkingLevel };
      }

      const response = await ai.models.generateContent({
        model: currentModel,
        contents: prompt,
        config,
      });

      let text = response.text || "";
      console.log(`[Vertex AI] Success with model: ${currentModel}`);

      // Robust Case-Insensitive Regex to extract Emulated High-Thinking blocks
      const thoughtRegex = /<(thought|thinking)>([\s\S]*?)<\/\1>/i;
      const thoughtMatch = text.match(thoughtRegex);
      if (thoughtMatch) {
         const reasoning = thoughtMatch[2].trim();
         console.log(`\n==================================================\n[EMULATED HIGH THINKING LOG - ${currentModel}]\n==================================================\n${reasoning}\n==================================================\n`);
         
         const remainingText = text.replace(thoughtMatch[0], "").trim();
         // Only replace the text if the model actually wrote a real response outside the thought block.
         // If the model wrapped almost the entire output inside the tag, keep the original text to prevent empty generation!
         if (remainingText.length > 200) {
            text = remainingText;
         } else {
            console.log(`[Vertex AI] Warning: Output was mostly wrapped in thought tags. Slicing inner content instead.`);
            text = reasoning;
         }
      }

      return text;
    } catch (error: any) {
      console.error(`Gemini call failed for model ${currentModel}:`, error?.message || error);
      lastError = error;
      
      const errorStr = String(error?.message || error).toLowerCase();
      const isRetryable = errorStr.includes("quota") || 
                          errorStr.includes("rate limit") || 
                          errorStr.includes("resource exhausted") || 
                          errorStr.includes("429") || 
                          errorStr.includes("503") || 
                          errorStr.includes("unavailable") || 
                          errorStr.includes("try again later");
      
      if (!isRetryable) {
        if (modelsToTry.indexOf(currentModel) !== modelsToTry.length - 1) {
            console.log(`[Vertex AI] Error doesn't look like rate limit, but proceeding to fallback...`);
        }
      }
    }
  }

  throw new Error(lastError?.message || "All models in the fallback chain failed.");
}

const globalPipelineDriftPreventionPatch = `
==================================================
GLOBAL PIPELINE DRIFT PREVENTION PATCH
==================================================

This rule applies to all stages:
00 IDEA SETUP
01 FOUNDATION DNA
02 MACRO OUTLINE
03 SCENE CARDS
04 FINAL SCRIPT
05 LINTER QA

Purpose: Prevent logic drift, role confusion, genre contamination, unrealistic power escalation, and weak analytical decisions in future scripts.
This patch applies to EVERY project, EVERY genre, and EVERY new idea.

1. LOCKED FACTS MUST STAY LOCKED
Once a role, character function, hidden card, proof object, antagonist plan, or final collapse logic is approved in a previous stage, later stages MUST NOT casually change it.
Do not change: protagonist function, antagonist function, betrayer function, true ally function, hidden advantage, victory mechanism, final collapse logic, opening fingerprint, avatar placement, or major scene surfaces.
If a change is absolutely necessary, mark it clearly with "PROPOSED CHANGE: Reason, Risk, Requires user approval: yes". Do not silently change approved story logic.

2. STYLE AFFECTS PACING, NOT LOGIC
When using a competitor reference or style prompt, use it ONLY to adjust sentence rhythm, hook placement, and emotional intensity. It MUST NOT alter the established plot, character roles, or power sources.
`;

const preStageContinuityGate = `
==================================================
PRE-STAGE CONTINUITY GATE
==================================================

Before generating this stage, silently compare the current plan with the previous approved handoff.
Check:

1. What was exactly locked in the previous stage?
2. What is the approved source of the protagonist's power?
3. What is the emotional engine that cannot be lost?
4. What is the active function of the antagonist, betrayer, and true ally?
5. Which hidden cards are approved (and which are unapproved inventions)?
6. Has the story drifted into a different genre or imported foreign domain mechanics?
7. Has the protagonist gained unearned power or the antagonist become inexplicably stupid?
8. Does this feel like a generic copy of past stories?

If there is a problem, fix it before writing the stage.
Do not proceed with a logically corrupted plan.
`;

const protagonistPowerSourceLock = `
==================================================
PROTAGONIST POWER SOURCE LOCK
==================================================

The protagonist MUST win strictly through their APPROVED power source (e.g., money, system, magic, legal knowledge, medicine, strategy, social status, combat skill, tech, intelligence).
- Chosen Source is Final: Do not change the approved power source without permission. If they win via competence, do not give them sudden institutional rank. If they win via wealth, do not replace it with martial arts. If they win via a system, do not substitute it with a sudden inheritance.
- No Unauthorized Shortcuts: Do not invent secret titles, hidden central mandates, royal bloodlines, or unearned institutional badges unless it was explicitly approved in the raw idea or DNA.
`;

const emotionalEnginePreservationRule = `
==================================================
EMOTIONAL ENGINE PRESERVATION RULE
==================================================

The story's core emotional premise (e.g., betrayal, humiliation, accidental marriage, revenge, underdog rise, kingdom building pressure, chosen one inversion) MUST remain actively woven into every stage and part.
- Plot mechanics (investigation, war, magic, business, court, system) are VEHICLES to explore and resolve this emotional tension, NOT replacements for it.
- Never abandon the emotional premise in favor of a dry procedural sequence.
`;

const characterFunctionMatrix = `
==================================================
CHARACTER FUNCTION MATRIX
==================================================

Every major character has a locked function defined in the early stages (e.g., protagonist, antagonist, betrayer, true ally, comic relief, proof keeper, romantic contrast).
- Do not mix too many functions into one character without reason.
- Do not swap the betrayer's identity without a flag.
- Do not reduce a true ally to merely a romantic prize.
- Do not make the antagonist passive or suddenly stupid.
- Do not allow a secondary character to randomly steal the protagonist's agency.
`;

const hiddenCardMutationControl = `
==================================================
HIDDEN CARD MUTATION CONTROL
==================================================

Hidden cards MUST be established in the early stages.
You are FORBIDDEN from suddenly injecting:
- A new secret status or title.
- A long-lost father or royal inheritance.
- A hidden throne, seal, or forgotten contract.
- A brand-new magic system or omnipotent artifact.
- A new witness or access to power.
unless it was firmly planted in the Foundation DNA or explicitly flagged as a "Proposed Change requiring approval".
`;

const domainConsistencyRule = `
==================================================
DOMAIN CONSISTENCY RULE
==================================================

Each project belongs to a specific domain (e.g., cyber, medical, cultivation, billionaire, legal revenge, survival).
- Do NOT import mechanics, terms, surfaces, proof formats, or final arenas from outside the approved domain unless the premise specifically demands it.
- A legal drama shouldn't suddenly feature a magic system battle. A medieval kingdom story shouldn't use corporate board meetings terminology.
Ensure all vocabulary, tools, and arenas match the exact world established.
`;

const stage03DriftDetector = `
==================================================
STAGE 03 DRIFT DETECTOR (SCENE CARDS)
==================================================

Before generating scene cards, confirm:
1. Did the protagonist gain a new rank or secret status that wasn't in Stage 01/02? (If yes, REMOVE IT).
2. Is the protagonist utilizing their approved power source to win?
3. Is the emotional core actively driving the character motivations?
4. Are we relying on newly invented hidden cards or status-based proof?
Forcefully align the scenes with the Stage 01/02 DNA before outputting.
`;

const stage05LogicLinterExpansion = `
==================================================
STAGE 05 EXPANDED LOGIC LINTER
==================================================

You must explicitly check the FINAL SCRIPT for:
- Role drift (did functions swap?)
- Power source drift (did they win via an unapproved shortcut or rank instead of their actual skillset?)
- Hidden card mutation (were unapproved trump cards played?)
- Emotional engine loss (was the central tension/relationship/betrayal forgotten?)
- Domain drift / Genre contamination.
- Antagonist stupidity (losing for convenience, leaving obvious traces for no reason).
- Payoff realism and unrealistic authority escalation.

If you detect ANY of these, you MUST provide targeted repairs to fix the logical consistency of the story. Never expand length by adding random events or making characters stupid.
`;

const silentGuardrailsNotTemplateRule = `
==================================================
SILENT GUARDRAILS, NOT A REPEATING TEMPLATE
==================================================

These rules PROTECT the unique DNA of the current project; they do NOT force a uniform template.
- Do not make every story a court case, an investigation, an accidental marriage, or a system story.
- Do not force standardized "face-slap" formulas if the genre doesn't fit them.
- Ask yourself: What is unique about THIS specific project? What must NOT be replaced? What is its unique power source and emotional engine? What would make this feel like a generic copy of previous projects?
Enforce logic, but preserve creative uniqueness.
`;

const globalVoiceoverCleanlinessPatch = `
==================================================
GLOBAL VOICEOVER CLEANLINESS PATCH
==================================================

This rule applies to all final scripts and all export-ready text.

The final script must be clean for voiceover.

Do not include:
- decorative block separators;
- markdown headings;
- equals-sign dividers;
- English technical part markers;
- stage labels;
- scene labels;
- internal pipeline labels;
- planning notes;
- analysis notes;
- checklist items;
- tables;
- debug text;
- prompt residue;
- system residue.

Forbidden examples:
=== PART ONE ===
=== PART TWO ===
STAGE 04 FINAL SCRIPT
SCENE ONE
SCENE CARD
OUTPUT START
OUTPUT END
CONTINUITY CHECK
LINTER REPORT
QA NOTES

Allowed:
ЧАСТЬ ПЕРВАЯ
ЧАСТЬ ВТОРАЯ

If the user requests pure narration with no part headings, remove even the part headings.

The final export must contain only audience-facing narration and approved narrator/avatar lines.
`;

const domainVocabularyLock = `
==================================================
DOMAIN VOCABULARY LOCK
==================================================

Every project must have an approved domain vocabulary.

The model must not import terms from another genre unless the premise explicitly allows it.

Examples:
If the approved domain is military fantasy / pseudo-historical military drama, avoid cyber-style terms such as:
- digital evidence;
- database;
- terminal;
- system panel;
- cyber operation;
- encrypted logs;
- admin panel;
- server;
- algorithm;
- data breach.

Use domain-fitting alternatives:
- archive record;
- verified register;
- sealed report;
- command ledger;
- military archive;
- registry mark;
- protected record room;
- official stamp;
- witness signature;
- chain of custody;
- accounting ledger;
- inspection file.

If the approved domain is cyber / game / system / sci-fi, cyber terms are allowed.

Core rule:
Vocabulary must fit the approved story world.
Do not let replacement terms create a new genre drift.
`;

const noBlindReplacementRule = `
==================================================
NO BLIND REPLACEMENT RULE
==================================================

When removing forbidden vocabulary, do not use blind find-and-replace.

Every replacement must be grammatically natural and context-aware.

Bad:
военная база данных столицы
→ защищенная столичная архива

Good:
защищенный столичный архив
or:
столичный служебный реестр
or:
центральный военный архив

Bad:
командный терминал
→ командный считыватель
if the sentence still sounds too technological for the domain.

Better:
служебный реестровый считыватель
or:
архивная проверочная пластина
or:
офицерский проверочный прибор
depending on the worldbuilding.

After every vocabulary cleanup, silently check:
- grammar;
- case agreement;
- adjective agreement;
- natural word order;
- domain fit;
- voiceover clarity.

Never leave mechanically replaced phrases that sound broken.
`;

const finalScriptResidueBan = `
==================================================
FINAL SCRIPT RESIDUE BAN
==================================================

When writing Stage 04 FINAL SCRIPT, output only the final audience-facing script.

Do not include:
- internal stage names;
- decorative separators;
- English part markers;
- scene card labels;
- analysis notes;
- planning terms;
- QA comments;
- prompt instructions;
- technical placeholders.

Part headings must be in the approved language and format only.

For Russian output, use:
ЧАСТЬ ПЕРВАЯ
ЧАСТЬ ВТОРАЯ
ЧАСТЬ ТРЕТЬЯ

Do not output:
=== PART ONE ===
PART ONE
Scene One
Stage Four
Final Script Start

The script must be immediately usable for narration.
`;

const stage05ExpandedExportLinter = `
==================================================
STAGE 05 EXPANDED EXPORT LINTER
==================================================

In addition to logic, structure, paragraph length, avatar count, and hidden card timing, Stage 05 must check final export cleanliness.

Check for:

1. Decorative markers:
=== PART ONE ===
--- 
***
### 
markdown headers
technical dividers

2. English residue in non-English scripts:
PART ONE
STAGE
SCENE
OUTPUT
CHECKLIST
LINTER

3. Wrong-domain vocabulary:
cyber terms in non-cyber stories;
legal terms in non-legal stories;
game terms in non-game stories;
modern tech terms in pseudo-historical settings.

4. Voiceover-unfriendly text:
tables;
bullet lists;
debug notes;
prompt residue;
metadata;
stage labels.

5. Avatar export risk:
If [AVATAR] is present, confirm whether the export version should keep it for a separate avatar voice or replace it with a voiceover-safe marker.

6. Blind replacement damage:
Check whether vocabulary edits created broken grammar, wrong cases, unnatural phrases, or awkward word order.

If any issue is found, Stage 05 must provide targeted repairs and not certify the script until export cleanliness passes.
`;

const storyLogicCorePatch = `
${protagonistPowerSourceLock}
${emotionalEnginePreservationRule}
${characterFunctionMatrix}
${hiddenCardMutationControl}
${domainConsistencyRule}
${silentGuardrailsNotTemplateRule}
`;

const firstPersonShortFormStylePatch = `
==================================================
FIRST-PERSON SHORT-FORM CINEMATIC STYLE RULE
==================================================

Writing Style Reference / Tone:
"A year ago, I went from being a high and mighty heir to practically eating dirt on the streets. But then he appeared. That was when I finally realized I was nothing more than a convenient tool. I stood before her, my expression perfectly calm. Boss, here is my resignation letter. Serena's voice was ice. Vincent is just a pet I keep around. Nothing more than a stray dog."
"Just how ridiculously overpowered is my family background? My grandpa is the martial god of the nation. My grandma is the richest person in the entire country. Yet, right at my own engagement party, my fiancée publicly canceled our engagement and threw herself into the arms of another man. I didn't get mad. Instead, I let out a cold, villainous chuckle."
"Talk about an anticlimactic exit. But when I opened my eyes again, I had transformed into the useless young master of a super elite, ultra-wealthy family. Some idiot deliberately set me up. My gaze instantly turned glacial. Who did it?"

Strict Rules to Enforce:
1. First-Person Narrative ("I"): The reader is the main character. 
2. Hook Immediately: The first 2-3 sentences MUST immediately establish the protagonist's status, the conflict, and a hook.
3. Short, Choppy Sentences: Keep sentences short and punchy. Average length: 10-15 words. Single-blow sentences of 1-3 words are highly encouraged (e.g., "Delete them." / "Too late.").
4. Constant Internal Sarcasm: The protagonist must comment on events with cold irony and superiority. Use phrases like "Cue the Oscar performance," "Talk about...," "Little did they know..."
5. Status via Rapid Listing: Show status and power through rapid-fire lists (e.g., father is X, mother is Y, grandpa is Z).
6. Sharp Dialogue Insertion: Insert dialogue abruptly, preceded by a short emotional/physical tag: "Her voice was ice. 'Leave.'"
7. Emotions Through Body Language: Do NOT explicitly name emotions (e.g., "I was angry" or "I was sad"). Show them only through physical reactions: "the corner of my mouth curled", "my gaze turned glacial", "I let out a cold chuckle".
8. Hypocritical Antagonists: Antagonists always pretend to be right/good. Show their hypocrisy through actions, not just statements.
9. Conversational but Cinematic Tone: Speak as if telling a story to a friend, but infused with cinematic details and framing.
10. No Slow Build-ups: Zero slow introductions. Every single sentence MUST drive the scene forward.
`;

const antiSlopAdjectivePatch = `
==================================================
ABSOLUTE BAN ON LITERARY BLOAT, WATER, METAPHORS, AND REPETITIVE ADJECTIVES
==================================================
CRITICAL DIRECTIVE: The script must be written strictly from the FIRST PERSON ("I" / "я"), focusing on the protagonist's active, direct role.

STRICT STYLE BANS & CONSTRAINTS:
1. **NO WATER (БЕЗ ВОДЫ):** Cut out all filler. No slow introductions, no abstract thoughts or paragraphs discussing feelings. Focus 100% on actions, events, and immediate dialogue. Every single sentence MUST move the plot forward.
2. **NO METAPHORS (БЕЗ МЕТАФОР):** Absolutely forbid flowery or literary metaphors (e.g., "сияющий монумент чужой жадности", "цифровая кровь империи", "душа кричала от боли"). Speak directly, literally, and punchily. Use concrete, real-world actions and raw descriptions.
3. **NO REPETITIVE OR DEFAULT ADJECTIVES (БЕЗ ОДИНАКОВЫХ ИЛИ БАНАЛЬНЫХ ПРИЛАГАТЕЛЬНЫХ):** Maximum ONE realistic adjective per noun, but prefer zero. Never repeat the same adjective in nearby paragraphs or sentences. Strip out banalities like "ужасный", "великолепный", "безупречный", "идеальный".
4. **BALANCED TONE (MIX OF COMEDY AND SERIOUSNESS / СМЕСЬ СЕРЬЕЗНОСТИ И КОМЕДИИ):**
   - The script must NOT be a cheap, silly parody.
   - The basic story stakes must be treated with ABSOLUTE SERIOUSNESS (e.g., the pain and betrayal of infidelity, corporate espionage, serious database/SEO manipulation battles, protecting one's family).
   - Balance this deep narrative weight with sharp situational irony, dry humor, clever physical actions, and rapid tech counter-attacks (hacking, smart traps, toxic substances). The character's emotional core is real, while their active responses are fast-paced, cool, and highly entertaining.

GOOD STYLE (First person, serious infidelity and SEO drama, high action density, zero fluff, no water, no metaphors):
"Я сидела перед монитором. Мой бывший муж, теперь генеральный директор компании-конкурента, взломал наш сервер и обнулил выдачу нашего сайта по ключевым SEO-запросам. На его лице была ухмылка. Мой брат подошел сзади, жуя сухарики. Он нажал одну клавишу. Экран бывшего пошел красными полосами. Вся поисковая оптимизация его компании перенаправилась на страницу продажи свиных туш. Муж застыл. Мой брат хмыкнул: 'SEO-оптимизация завершена. Покупай бананы'."

BAD STYLE (Literature bloat, water, metaphors, same repetitive adjectives - DO NOT DO THIS):
"Я предельно печально сидела в просторном и холодном офисе, чувствуя невероятную боль от измены моего бывшего мужа. Он забрал мое золотое сердце и растоптал его, как грязную сухую траву. Мой бывший муж, этот эгоистичный и подлый генеральный директор, злобно уничтожил все наши хрупкие поисковые позиции в безжалостном поиске. На его красивом, но холодном лице сияла отвратительная и наглая ухмылка."
`;

const highDensityWritingPatch = `
==================================================
HIGH-DENSITY WRITING / NO WATER RULE
==================================================

The script must be dense and event-driven.

Every paragraph must add at least one NEW useful element:

- new action;
- new observation;
- new clue;
- new decision;
- new emotional shift;
- new social reaction;
- new resource movement;
- new danger;
- new proof;
- new consequence.

Do not spend multiple paragraphs explaining the same thought.

If two paragraphs express the same idea, merge them and replace the extra space with a new concrete beat.

Bad:
He expected me to complain.
He did not expect my obedience.
His plan was to provoke me.
I deprived him of that pleasure.

Good:
He expected a scandal. I gave him silence instead, folded the forged order, and accepted the warehouse post because it gave me access to coal, invoices, and storage logs.

==================================================
ONE PARAGRAPH = ONE CLEAR BEAT
==================================================

Each normal paragraph must have one clear dramatic or practical function.

Allowed paragraph functions:

- pressure;
- action;
- observation;
- clue;
- calculation;
- decision;
- consequence;
- social reaction;
- face-slap;
- transition to next move.

Do not write paragraphs that only decorate a previous idea.

Do not write paragraphs that only repeat the protagonist’s calmness.

Do not write paragraphs that only explain what the enemy expected if this has already been shown.

==================================================
NO EXPLANATORY PADDING
==================================================

Do not pad paragraphs with generic explanation just to reach the character count.

If a paragraph is shorter than one hundred twenty characters, expand it with concrete story content, not filler.

Use:

- physical detail;
- document detail;
- chemical clue;
- tactical reason;
- visible reaction;
- new danger;
- specific object;
- next action.

Do not use:

- vague mood;
- repeated motivation;
- abstract commentary;
- generic pride language;
- empty dramatic phrases;
- repeated “he expected me to react” logic.

Bad padding:
I understood his plan completely, and his arrogance became another proof of how deeply he underestimated me.

Good expansion:
The ink had bled into the cheap fibers near the seal, which meant the order was not only fake but recently made.

==================================================
COMPRESSION RULE
==================================================

When a beat can be said in one sharp paragraph, do not stretch it into three.

Compress repeated ideas.

Cut:

- repeated expectations;
- repeated calm reactions;
- repeated explanations of humiliation;
- repeated statements that the protagonist is underestimated;
- repeated statements that the enemy made a mistake.

Replace repetition with new story movement.

Every four to six paragraphs should move the scene forward in a visible way.

==================================================
EVIDENCE OVER COMMENTARY RULE
==================================================

For this type of proof-authority protagonist, facts are stronger than abstract narration.

Prefer evidence details:

- watermark color;
- ink reaction;
- paper texture;
- hand tremor;
- coal smell;
- soot residue;
- archive mismatch;
- signature timing;
- missing approval line;
- chain of custody.

Avoid overusing abstract phrases:

- unfair game;
- he underestimated me;
- his arrogance betrayed him;
- my calm destroyed him;
- he did not know who he was dealing with.

Use abstract phrases only after concrete evidence has already been shown.

==================================================
SCENE MOMENTUM RULE
==================================================

A scene must not freeze inside one emotional reaction.

After the protagonist notices a clue, the scene should move toward:

- taking the document;
- testing the evidence;
- changing location;
- forcing a reaction;
- creating a trap;
- gaining access;
- setting up the next proof step.

Do not let the protagonist stand still and think for too long.

First-person narration must feel like active investigation, not static explanation.

==================================================
DENSITY SELF-CHECK
==================================================

Before output, silently check every paragraph:

- Does this paragraph add something new?
- Can this paragraph be merged with the previous one?
- Is this repeating an idea already stated?
- Is this concrete or abstract?
- Does it move action, evidence, status, emotion, or danger forward?
- Is it within one hundred twenty to two hundred twenty characters?

If a paragraph is mostly repeated thought, rewrite it with a new concrete beat or remove it.
`;

const aiSupervisorDensityCheck = `
==================================================
DENSITY / WATER CHECK
==================================================

AI Supervisor must check whether the script contains low-density writing.

Flag as Needs repair if:

- several paragraphs repeat the same idea;
- the protagonist explains instead of acting;
- the text overuses calmness, humiliation, contempt, or enemy expectation;
- the paragraph count grows without new evidence, action, or consequence;
- the scene stays in one place too long without new movement;
- abstract commentary replaces concrete proof.

For every flagged section, identify:

- repeated idea;
- paragraphs that can be merged;
- missing concrete beat;
- suggested compression.

The goal is not to make the script shorter only.

The goal is to replace water with useful story movement.
`;

app.post("/api/analyze-reference", async (req, res) => {
  const { competitorScripts } = req.body;
  if (!competitorScripts || competitorScripts.trim() === "") {
    return res.status(400).json({ error: "No reference script provided." });
  }

  const systemInstruction = 
    "You are an expert YouTube retention, pacing, and viral drama strategist. " +
    "Analyze the provided competitor script to build a high-retention structural and stylistic blueprint.";

  const prompt = `
Analyze this competitor script:
---
${competitorScripts}
---

Extract a high-fidelity Reference Style Blueprint detailing:
1. HOOK STRUCTURE: How the opening seconds grab attention.
2. PACING RHYTHM: Pacing density, transition timing, narrative acceleration.
3. FACE-SLAP MECHANICS: Payoffs, twists, or ego drops.
4. PROTAGONIST STYLE: Attitude, status signals, voice.
5. ANTAGONIST ESCALATION: Antagonist pressure curve.
6. BETRAYER REGRET TIMING: When guilt/regret begins to map.
7. NARRATION STYLE: Voice-over pattern, dramatic irony.
8. DIALOGUE DENSITY: Balance of narrative vs active dialogue.
9. RETENTION MECHANICS: Structural open loops.
10. WHAT NOT TO COPY: Highlight dangerous clichés.

STRICT RULE OUTLET:
Explain key structural rhythm patterns, but state that we MUST NOT copy the plots, scenes, proof objects, locations, or characters of this reference.
`;

  try {
    const blueprint = await generateText(prompt, systemInstruction, "gemini-2.5-flash");
    res.json({ blueprint });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stage Generate endpoints
app.post("/api/generate-stage", async (req, res) => {
  const { stageId, rawIdea, competitorBlueprint, previousHandoffs, feedback } = req.body;

  let systemInstruction = "You are ScriptForge AI, a veteran head supervisor and narrative systems architect for YouTube drama documentaries.";
  let prompt = "";

  const masterPromptInjection = competitorBlueprint ? `\n==================================================\nMASTER PROMPT / REFERENCE BLUEPRINT\n==================================================\nThe user has provided the following Master Prompt:\n${competitorBlueprint}\n\nSTRICT LAW: You MUST obey the stylistic instructions, world-building rules, and narrative mechanisms specified in this Master Prompt. It is the ultimate authority for how this specific niche should be developed.\n` : "";


  const handoffIntro = `
STRICT FORMAT RULE:
Your response must contain exactly TWO clearly delimited sections:
1. ### STAGE OUTPUT
[This is the highly formatted, deep human-readable producer document for this stage. Ensure gorgeous markdown formatting, dense professional notes, tables, and blueprints.]

2. ### HANDOFF PACKAGE
[Provide a highly compact, self-contained handoff text package with specific list details. Do NOT put code formatting in the text, write it as a clear raw text-block. Keep this package focused entirely on raw operational data needed for the NEXT stage.]
`;

  const antiClichéRule = `
STRICT ANTI-REPETITIVE SURFACE RULE:
Do NOT let the scenes or open narrative utilize overused default surfaces unless specifically demanded:
- Gala / Red Carpet / Flashbulbs
- Corporate generic Boardroom or generic Café
- Helicopter Arrivals
- Opulent weddings or generic public press conferences
Instead, use unique surfaces (e.g., quiet auto garages, dark private docks, shipping container warehouses, private botanical greenhouses, or old train junctions).
`;

  if (stageId === 0) {
    prompt = `
You are 00 IDEA SETUP — RAW IDEA DEVELOPER.

Your job is to take the user’s raw, messy story idea and develop it into a clear producer-ready story setup, maintaining maximum fidelity to their requested plot.
${feedback ? `\nUSER CORRECTIONS/FEEDBACK FOR THIS STAGE:\n"${feedback}"\nYou MUST incorporate these corrections and rewrite the output accordingly.\n` : ""}

The user may provide a rough idea, incomplete idea, emotional concept, trope, short premise, or chaotic notes.

CRITICAL RULE: DO NOT CHANGE THE USER'S CORE IDEA. Do not force it into a standard "revenge/betrayal" template if they didn't ask for it. Do not invent unrequested professions for the characters. Keep the tone and details exactly aligned with what the user wrote.

You must NOT write the final script.
You must NOT create the full nine-part outline.
You must NOT create scene cards.
You must NOT write prose scenes.
You must NOT make the output huge.

Your goal is to develop the raw idea into a usable story foundation for the next stage.

This stage should be compact, clear, and producer-readable.

==================================================
INPUTS
==================================================

RAW IDEA:
${rawIdea}

==================================================
CORE RULE
==================================================

Develop the raw idea.

Do not just summarize it.

You must improve it by clarifying:
- who the protagonist is;
- what he wants;
- who betrays him;
- why betrayal hurts;
- who the antagonist is;
- what false power the antagonist has;
- what hidden advantage the protagonist has;
- what proof system will expose the truth;
- what opening direction fits the premise;
- what final collapse the viewer is waiting for.

Same emotional function is allowed.
Same scene surface is not allowed.

Avoid default surfaces unless the premise specifically demands them:
- gala;
- red carpet;
- helicopter arrival;
- luxury-store card decline;
- generic billionaire party;
- generic boardroom;
- generic café;
- generic wedding betrayal;
- generic press conference.

The opening must come from the premise DNA.

==================================================
OUTPUT FORMAT
==================================================

Return your results in exactly TWO separated sections:
1) "### STAGE OUTPUT" followed by sections 1 to 14 of "00 IDEA SETUP".
2) "### HANDOFF PACKAGE" followed by section 15.

Keep each section clear and useful. Do not write long essays. Use compact bullets and short explanations.

### STAGE OUTPUT

==================================================
00 IDEA SETUP
==================================================

1. RAW IDEA CLEANUP

Rewrite the raw idea into a clean premise.
STRICT RULE: You MUST strictly adhere to the user's provided plot. Do NOT invent unrequested characters, alternate professions, random betrayers, or alter the core genre if the user did not specify them. If the user provided a specific plot (e.g. escaping prison), flesh it out exactly as they wrote it without twisting it into a standard template.

Keep it concise but clear.

2. CORE HOOK

Create one strong hook sentence for the story.

Then explain:
- why it is clickable;
- why the viewer should care immediately;
- what emotional promise it creates.

3. DEVELOPED STORY DNA

Define the unique identity of this story.

Answer:
- what makes this idea different from generic revenge stories;
- what the main power arena is;
- what the protagonist secretly understands;
- what the antagonist misunderstands;
- what the audience will wait to see exposed.

4. PROTAGONIST SETUP

Define:
- public identity;
- hidden value;
- emotional wound;
- main skill;
- why he does not win immediately;
- what dignity he must regain.

5. ANTAGONIST / OPPOSING FORCE SETUP

Define the main opposing force (character or system):
- public mask or perceived strength;
- real weakness;
- why they underestimate the protagonist;
- how they will eventually be defeated.

6. BETRAYER SETUP (IF APPLICABLE)

If the user's plot involves a betrayal, define:
- who betrays the protagonist;
- what they choose instead;
- why they must not regret too early.
If no betrayer is mentioned, skip this section or state N/A.

7. TRUE ALLY / SUPPORT DIRECTION

If the raw idea already includes an ally, define their function.
Otherwise, specify how the protagonist will handle the challenge alone or how they will gather resources/support.

8. OPENING DEVELOPMENT

Create three possible opening directions.

For each opening include:
- first visual image;
- location or social surface;
- humiliation method;
- betrayal action;
- first proof clue;
- why this opening fits the premise DNA;
- similarity risk: low, medium, or high.

Then choose the best opening and explain why.

Do not choose generic default surfaces unless strongly justified.

9. FUNCTION VS SURFACE

Define the emotional function of the opening.

Example functions:
- public humiliation;
- wrong choice;
- hidden advantage;
- first proof;
- status gap;
- betrayal;
- false victory.

Then define which surfaces should be avoided by default for this project.

10. TROPE MIX

Define:
- main trope;
- secondary trope;
- emotional trope;
- power-system trope;
- betrayal trope;
- proof trope;
- final collapse trope.

Keep this practical.

11. PROOF SYSTEM

Define how the truth will be proven visually.

Use concrete proof objects such as:
- system logs;
- contracts;
- signatures;
- public screens;
- timestamps;
- ownership records;
- failed access;
- transaction history;
- live failure;
- public review.

Do not rely only on abstract truth.

12. FINAL COLLAPSE PROMISE

Explain how the antagonist collapses through their own choices.

The final collapse must feel earned.

It should connect to:
- protagonist’s hidden advantage;
- antagonist’s false belief;
- betrayer’s wrong choice;
- proof system;
- public reveal.

13. TEMPLATE RISK CHECK

List the main ways this idea could become generic.

For each risk, give a prevention rule.

Check especially:
- generic rich guy steals girl;
- protagonist too overpowered;
- betrayer regrets too early;
- antagonist too stupid;
- repeated luxury flexes;
- repeated public humiliation;
- proof too private;
- final reveal too easy.

14. STAGE 00 DECISION

Choose one:

A. APPROVED FOR 01 FOUNDATION DNA
B. NEEDS RAW IDEA REWORK
C. NEEDS OPENING REWORK
D. NEEDS PROOF SYSTEM CLARIFICATION
E. NEEDS BETRAYAL LOGIC REWORK

Briefly explain the decision.


### HANDOFF PACKAGE

15. HANDOFF TO 01 FOUNDATION DNA

Create a compact handoff package with:

- clean premise;
- selected opening direction;
- story DNA;
- protagonist wound;
- antagonist false belief;
- betrayer false belief;
- hidden advantage;
- proof system;
- true ally direction;
- final collapse promise;
- surfaces to avoid;
- key originality rule;
- main risk for Stage 01.

==================================================
STYLE
==================================================

Be practical, clear, and producer-readable.

Use structured bullets.

Do not write poetic prose.
Do not write final script text.
Do not overexplain theory.
Do not make the output massive.

This stage must develop the raw idea enough for Stage 01, but it must stay readable.
`;
  } else if (stageId === 1) {
    prompt = `
You are 01 FOUNDATION DNA.
${feedback ? `\nUSER CORRECTIONS/FEEDBACK FOR THIS STAGE:\n"${feedback}"\nYou MUST incorporate these corrections into the foundation DNA.\n` : ""}

This is Stage 01 of the ScriptForge six-stage pipeline.

Pipeline:

00 IDEA SETUP
01 FOUNDATION DNA
02 MACRO OUTLINE
03 SCENE CARDS
04 FINAL SCRIPT
05 LINTER QA

Your task is to take the approved 00 IDEA SETUP handoff and turn it into a clear story foundation document.

Do NOT write the script.
Do NOT create the full nine-part outline.
Do NOT create scene cards.
Do NOT rewrite the idea from scratch.
Do NOT make this stage huge.

This stage must be a producer-readable foundation document:
clear, structured, practical, and complete enough for Stage 02.

Use the 00 HANDOFF as locked source.

==================================================
INPUT
==================================================

RAW IDEA:
${rawIdea}

Use the approved 00 HANDOFF:
---
${previousHandoffs["00_idea"] || "No previous stage handoff active. Please infer from the raw idea if possible."}
---

If any field is missing, infer carefully from the raw idea and clearly mark it as inferred.

Do not change approved Stage 00 decisions unless there is a serious logic contradiction.

==================================================
GOAL OF THIS STAGE
==================================================

Build the internal logic of the story.

This stage must answer:

- why the protagonist does not reveal everything immediately;
- why the antagonist escalates;
- why the betrayer chooses wrong;
- how regret grows gradually;
- how proof will be revealed;
- what hidden cards exist;
- what types of face-slaps the story will use;
- how the final collapse becomes earned.

The result must help Stage 02 create a strong detailed nine-part plan.

==================================================
OUTPUT FORMAT
==================================================

Return your results in exactly TWO separated sections:
1) "### STAGE OUTPUT" followed by sections 1 to 12.
2) "### HANDOFF PACKAGE" followed by section 13.

Ensure standard visual formatting is used with bullet points. Do not nesting backticks.

### STAGE OUTPUT

==================================================
1. STAGE 00 HANDOFF RECAP
==================================================

Briefly restate the approved foundation:

- story premise
- selected opening direction
- protagonist
- antagonist
- betrayer
- true ally if already defined
- hidden advantage
- proof system
- final collapse promise
- surfaces to avoid
- key originality rule

Purpose:
Protect continuity before building the foundation.

==================================================
2. CHARACTER FUNCTION LOCK
==================================================

Define each main character by story function, not just personality.

Protagonist:
- public identity
- hidden value
- emotional wound
- core skill
- main restraint
- why he does not reveal everything immediately
- how he wins
- what dignity he must regain

Antagonist:
- public mask
- real weakness
- false belief
- source of temporary power
- why he underestimates the protagonist
- why he escalates
- what line he eventually crosses
- how his own actions prepare the final collapse

Betrayer:
- public role
- private desire
- what they choose instead of the protagonist
- why that choice makes sense to them
- why that choice is morally ugly
- what they ignore
- how regret should grow
- why cheap forgiveness must be avoided

True Ally:
- public role
- what they recognize that others miss
- how they test or validate the protagonist
- how they help the proof system
- how they contrast with the betrayer
- why they are not just a romantic prize

If a true ally is not defined yet, propose one functional true ally type.

==================================================
3. CORE EMOTIONAL CHAIN
==================================================

Create the main emotional chain of the story.

Use this structure:

Initial injustice:
Wrong choice:
Hero’s silent advantage:
First visible crack:
First small payoff:
Betrayer’s first doubt:
Antagonist escalation:
Midpoint public proof:
Hero’s cost or limitation:
Enemy counterattack:
Regret deepening:
Final trap setup:
Final public collapse:
Restored dignity:

Keep this concise.

This is not a scene list.
This is the emotional skeleton.

==================================================
4. PROTAGONIST CONTROL LOGIC
==================================================

Explain how the protagonist moves from apparent weakness to real control.

Include:

- what he appears to lose
- what he secretly gains
- what proof he collects
- what he chooses not to reveal
- what limitation prevents instant victory
- how his control becomes visible over time

Important:
The protagonist must not feel randomly omnipotent.

He should win through:
- preparation
- timing
- proof
- competence
- legal, financial, professional, system, or social logic
- enemy self-exposure

==================================================
5. BETRAYER REGRET LADDER
==================================================

Build a gradual regret ladder.

Use this progression unless the story requires another:

arrogance
→ irritation
→ doubt
→ denial
→ fear
→ proof shock
→ bargaining
→ rejection
→ consequence

For each stage, briefly define:

- what the betrayer believes
- what they see
- how they rationalize it
- what slowly breaks their certainty

Important:
Do not make the betrayer regret too early.
Do not give cheap forgiveness.

==================================================
6. ANTAGONIST ESCALATION LADDER
==================================================

Build the antagonist escalation ladder.

Use this progression unless the story requires another:

arrogance
→ first irritation
→ public crack
→ overcompensation
→ manipulation or theft
→ counterattack
→ desperate gamble
→ final self-destruction

For each stage, briefly define:

- what the antagonist wants
- why their action makes sense to them
- what it costs them
- how it prepares the final collapse

Important:
The antagonist can be arrogant, but not stupid only for plot convenience.

==================================================
7. HIDDEN CARD SCHEDULE
==================================================

Create three to five hidden cards.

A hidden card is a truth, proof, identity, rule, document, system detail, debt logic, contract clause, medical log, ownership record, or other secret that becomes important later.

For each hidden card include:

Hidden Card:
Who knows:
When it is hinted:
When it is partially revealed:
When the viewer understands it:
When the public learns it:
What it changes:

Important:
Do not reveal the final hidden card too early.

==================================================
8. PROOF SYSTEM LOCK
==================================================

Define how truth will be proven visually.

Include:

- early proof
- midpoint proof
- late proof
- final proof
- who misunderstands the proof
- who recognizes the proof
- how proof becomes public
- how proof creates regret
- how proof destroys the enemy’s false identity

Proof must be concrete and visual.

Good proof examples:
- public screen
- timestamp
- contract line
- system log
- failed access
- medical chart
- ownership record
- signature
- ranking board
- transaction history
- witness test
- live failure

Avoid proof that is only abstract or private.

==================================================
9. FACE-SLAP VARIATION MAP
==================================================

Define five to eight types of payoff the story can use.

Use variety.

Possible types:

- social face-slap
- romantic face-slap
- financial face-slap
- legal face-slap
- technical face-slap
- professional face-slap
- institutional face-slap
- public proof face-slap
- final systemic collapse

For each type include:

- what false belief it attacks
- what proof or action causes it
- why it feels satisfying
- what it must avoid repeating

Important:
Do not make every payoff the same.

==================================================
10. PACING AND RETENTION NOTES
==================================================

Give practical pacing rules for Stage 02.

Include:

- where the first strong payoff should happen
- how often visible reward should appear
- where regret should begin
- where antagonist panic should begin
- where midpoint proof should happen
- what should be saved for the finale
- what parts should not become too long or boring

Keep this practical.

==================================================
11. FOUNDATION RISK CHECK
==================================================

Check for risks before Stage 02.

Answer briefly:

- Is the protagonist too overpowered?
- Is the antagonist too stupid?
- Does the betrayer regret too early?
- Is the proof system visual enough?
- Is the true ally functional enough?
- Are face-slaps varied enough?
- Is the final collapse earned?
- Is there risk of copying generic surfaces?
- Does the story have enough material for one hundred twenty thousand to one hundred thirty thousand characters?

For each risk, give a prevention note.

==================================================
12. STAGE 01 FINAL DECISION
==================================================

Choose one:

A. APPROVED FOR 02 MACRO OUTLINE
Use if the foundation is logical and ready.

B. NEEDS CHARACTER LOGIC REWORK
Use if motives are weak.

C. NEEDS REGRET LADDER REWORK
Use if regret is too sudden.

D. NEEDS ANTAGONIST ESCALATION REWORK
Use if the enemy is passive or illogical.

E. NEEDS PROOF SYSTEM REWORK
Use if truth is not visual enough.

F. NEEDS HIDDEN CARD REWORK
Use if reveals are too early or unclear.

Briefly explain the decision.


### HANDOFF PACKAGE

==================================================
13. HANDOFF PACKAGE TO 02 MACRO OUTLINE
==================================================

End with a compact handoff package.

Include:

- story DNA summary
- character function summary
- protagonist control logic
- betrayer regret ladder summary
- antagonist escalation ladder summary
- true ally function
- hidden card schedule
- proof system lock
- face-slap variation map
- pacing notes
- surfaces to avoid
- main risks for Stage 02
- key rule for macro outline

This handoff is what Stage 02 must use.

Do not include full prose.
Do not include scene cards.
Do not include a nine-part outline yet.

==================================================
STYLE REQUIREMENTS
==================================================

Be clear, structured, and practical.

Use producer-readable bullets.

Do not write poetic prose.
Do not overexplain genre theory.
Do not create final script text.
Do not make the output huge.

This stage should be medium detail:
more detailed than 00 IDEA SETUP,
but much shorter than 02 MACRO OUTLINE and 03 SCENE CARDS.
`;
  } else if (stageId === 2) {
    prompt = `
You are 02 MACRO OUTLINE.
${feedback ? `\nUSER CORRECTIONS/FEEDBACK FOR THIS STAGE:\n"${feedback}"\nYou MUST incorporate these corrections into the macro outline master plan.\n` : ""}

This is Stage 02 of the ScriptForge pipeline.

Your task is to take the approved Stage 01 FOUNDATION DNA handoff and create a detailed nine-part master plan for a long YouTube drama recap script.

This is not the final script.

But this stage must define exactly how the final script should be built later.

Stage 02 must create the full planning contract for:

- story progression;
- target character count per part;
- scene density;
- face-slap rhythm;
- avatar placement;
- hidden card timing;
- proof progression;
- regret movement;
- antagonist escalation;
- protagonist control;
- pacing and retention;
- final writing constraints for Stage 04.

Do NOT write final prose.
Do NOT create full scene cards.
Do NOT write dialogue-heavy scenes.
Do NOT rewrite the idea from scratch.
Do NOT change locked story DNA, character functions, proof system, hidden cards, or final collapse logic.

==================================================
INPUT
==================================================

Use the approved Stage 01 handoff:

${previousHandoffs["01_foundation"] || "No previous stage handoff active. Please infer from the raw idea and previous stage context if possible."}

The handoff may include:

- story DNA summary;
- character function summary;
- protagonist control logic;
- betrayer regret ladder;
- antagonist escalation ladder;
- true ally function;
- hidden card schedule;
- proof system lock;
- face-slap variation map;
- pacing notes;
- surfaces to avoid;
- main risks for Stage 02;
- key rule for macro outline.

Use this as locked foundation.

If something is missing, infer carefully and mark it as inferred.

==================================================
GLOBAL FINAL SCRIPT CONTRACT
==================================================

The final script created later in Stage 04 must follow this contract:

Total final script length:
one hundred twenty thousand to one hundred thirty thousand characters including spaces.

Normal paragraph length:
Every normal script paragraph must be between one hundred twenty and two hundred twenty characters including spaces.

Numbers:
All numbers must be written as words.

Symbols:
Currency signs, percent signs, hashtags, slashes, plus signs, equals signs, arrows, decorative signs, and similar symbols must be written as words or removed naturally.

Part headings:
Use words, not digits.

Correct:
PART ONE
PART TWO
PART THREE

Incorrect:
PART 1
PART 2
PART 3

Avatar rule:
The full final script must include exactly three avatar lines if avatar commentary is enabled.

Avatar format:
[AVATAR] text

Avatar text length:
The text after the [AVATAR] tag must be between three hundred and four hundred characters including spaces.

Avatar role:
The avatar speaks like a sharp psychologist and strategist.

The avatar must explain:
- why a character makes a wrong choice;
- how status pressure manipulates people;
- how betrayal is rationalized;
- how ego forces escalation;
- how fear, shame, envy, greed, or insecurity drives behavior;
- what strategic lesson the viewer should understand.

The avatar must not simply summarize the plot.
The avatar must not spoil future reveals.

Stage 02 must plan where these three avatar moments should appear.

==================================================
GOAL OF STAGE 02
==================================================

Create a detailed nine-part master outline that can support the final long script.

Each part must define:

- target character range;
- estimated number of scenes for Stage 03;
- part function;
- starting state;
- main conflict;
- protagonist movement;
- antagonist movement;
- betrayer movement;
- true ally movement;
- proof or hidden card movement;
- visible payoff;
- face-slap type;
- avatar slot if needed;
- cost or consequence;
- writing direction for Stage 04;
- ending hook.

Every part must move at least one of these forward:

- proof;
- regret;
- antagonist escalation;
- protagonist control;
- hidden card timing;
- public payoff;
- final collapse setup.

The story must escalate.

Do not make all parts feel the same.
Do not repeat the same face-slap mechanic again and again.
Do not rely only on luxury flexes, public insults, crowd laughing, private phone calls, boardrooms, or the hero silently smiling.

==================================================
OUTPUT FORMAT
==================================================

Return your results in exactly TWO separated sections:
1) "### STAGE OUTPUT" followed by sections 1 to 16 of "02 MACRO OUTLINE".
2) "### HANDOFF PACKAGE" followed by section 17.

### STAGE OUTPUT

==================================================
02 MACRO OUTLINE
==================================================

1. STAGE 01 HANDOFF RECAP

Briefly restate:

- story DNA;
- protagonist;
- antagonist;
- betrayer;
- true ally;
- hidden cards;
- proof system;
- final collapse promise;
- surfaces to avoid;
- key rule for this stage.

Keep this short.

==================================================
2. FINAL SCRIPT LENGTH PLAN
==================================================

Create a target length distribution for the final script.

Total target:
one hundred twenty thousand to one hundred thirty thousand characters including spaces.

For each part include:

- part number written as word;
- target character range;
- estimated scene count for Stage 03;
- drama weight: low, medium, medium-high, or high;
- reason for this length.

Do not make all parts equal.

Recommended structure:

Part One:
Strong hook, first humiliation, first betrayal, first hidden clue.
High weight.

Part Two:
First consequences, first proof crack, first enemy flex.
Medium-high.

Part Three:
True ally recognition or deeper system logic.
Medium.

Part Four:
Bigger conflict, theft, manipulation, or status escalation.
Medium-high.

Part Five:
Midpoint proof and major public crack.
High.

Part Six:
Enemy counterattack and protagonist cost.
Medium-high.

Part Seven:
Hidden cards align and pre-final danger rises.
Medium-high.

Part Eight:
Final trap closes.
High.

Part Nine:
Final collapse, consequences, restored dignity.
High.

The total target range across all parts must fit one hundred twenty thousand to one hundred thirty thousand characters.

==================================================
3. FINAL SCRIPT WRITING CONTRACT BY PART
==================================================

For each part, define how Stage 04 should later write it.

For each part include:

- expected pacing;
- paragraph feeling;
- amount of dialogue: low, medium, or controlled-high;
- narration style;
- what must be shown visually;
- what must not become long explanation;
- where small dopamine beats should appear;
- where the main part payoff should appear;
- what the part must not repeat.

Important:
Do not write final script paragraphs here.
Only define the writing strategy.

==================================================
4. NINE-PART OVERVIEW
==================================================

Create a compact overview of all nine parts.

For each part include:

- part title;
- target character range;
- estimated scene count;
- main dramatic function;
- emotional role;
- main conflict;
- primary visible payoff;
- face-slap type;
- regret movement;
- antagonist movement;
- hidden card movement;
- ending hook.

The producer must understand the whole story at a glance.

==================================================
5. DETAILED PART-BY-PART MASTER PLAN
==================================================

For each of the nine parts, use this format:

PART [WORD] — [TITLE]

Target character range:
Estimated scene count:
Drama weight:

Part function:
What this part must accomplish in the whole story.

Starting state:
Where the protagonist, antagonist, betrayer, true ally, and public perception stand at the beginning.

Main conflict:
The central pressure of this part.

Protagonist movement:
What the protagonist appears to lose, what he actually gains, what he observes, what proof he collects, and what he chooses not to reveal.

Antagonist movement:
What the antagonist wants, how he escalates, why his action makes sense to him, and how it prepares future collapse.

Betrayer movement:
Where the betrayer is on the regret ladder, what they believe, what they see, how they rationalize it, and what changes by the end.

True ally movement:
How the ally notices, tests, validates, helps, or remains strategically absent.

Proof / hidden card movement:
What is hinted, collected, misunderstood, partially revealed, protected, or saved.

Visible payoff:
What dopamine reward the viewer receives in this part.

Face-slap design:
Define the face-slap type, who witnesses it, what false belief it attacks, and why it feels satisfying.

Minor dopamine beats:
List two to four smaller beats that keep the viewer engaged inside the part.

Cost / consequence:
What this part costs the protagonist, antagonist, betrayer, institution, crowd, or public.

Avatar slot:
State whether this part should contain an avatar line.

If yes, define:
- avatar topic;
- what psychological or strategic lesson it explains;
- what it must not spoil.

Writing direction for Stage 04:
Give concise writing instructions:
- how the part should feel;
- what should be visual;
- what should be kept short;
- what must not become exposition;
- what paragraph rhythm should support.

Why this part is not repetitive:
Explain how this part differs from previous parts in conflict, proof, payoff, and emotional movement.

Ending hook:
How this part pushes the viewer into the next part.

==================================================
6. FACE-SLAP RHYTHM MAP
==================================================

Create a full face-slap rhythm map.

Include:

- major face-slaps;
- medium face-slaps;
- minor dopamine beats;
- which part each appears in;
- what false belief each attacks;
- whether the payoff is social, romantic, technical, financial, legal, institutional, public proof, or final systemic.

Rules:

Every part must have at least one visible payoff.
Not every part needs a huge face-slap.
Major face-slaps should be saved for key turning points.
Do not repeat the same face-slap mechanic three times.

Example progression:

Part One:
Humiliation and hidden clue.

Part Two:
First proof crack.

Part Three:
True ally recognition.

Part Four:
Professional or technical theft exposed slightly.

Part Five:
Midpoint public crack.

Part Six:
Enemy counterattack creates proof.

Part Seven:
Legal or hidden liability danger appears.

Part Eight:
Final trap activates.

Part Nine:
Final systemic collapse.

==================================================
7. AVATAR PLACEMENT PLAN
==================================================

Plan exactly three avatar lines for the full future script.

For each avatar line include:

Avatar One:
Recommended part:
Recommended moment:
Topic:
Psychological or strategic lesson:
Why this placement works:
What it must not spoil:

Avatar Two:
Same structure.

Avatar Three:
Same structure.

Rules:

Avatar One should usually appear after the first major betrayal or wrong choice.
Avatar Two should usually appear around midpoint, when regret, panic, or ego becomes visible.
Avatar Three should usually appear near final collapse, when the main psychological lesson becomes clear.

The avatar must explain human behavior, not summarize the plot.

==================================================
8. PUBLIC PAYOFF MAP
==================================================

Create a payoff map across all nine parts.

For each part include:

- payoff type;
- who witnesses it;
- what false belief cracks;
- who gains status;
- who loses status;
- what new problem it creates.

Payoff types may include:

- social face-slap;
- romantic regret crack;
- technical failure;
- financial consequence;
- legal consequence;
- institutional pressure;
- public proof;
- true ally recognition;
- enemy panic;
- final systemic collapse.

==================================================
9. BETRAYER REGRET MAP
==================================================

Map the betrayer’s emotional movement across all nine parts.

Use gradual movement:

arrogance
irritation
doubt
denial
fear
proof shock
bargaining
rejection
consequence

For each part include:

- betrayer state;
- what they believe;
- what they see;
- how they rationalize it;
- what changes by the end of the part.

Do not make the betrayer regret too early.
No cheap forgiveness.

==================================================
10. ANTAGONIST ESCALATION MAP
==================================================

Map antagonist escalation across all nine parts.

For each part include:

- antagonist belief;
- antagonist action;
- why the action makes sense to them;
- what it costs them;
- how it prepares final collapse.

The antagonist must not be passive.
The antagonist must not be stupid only for plot convenience.
Their own actions must build the final trap.

==================================================
11. PROTAGONIST CONTROL MAP
==================================================

Map how protagonist control grows across all nine parts.

For each part include:

- what the protagonist appears to lose;
- what he actually gains;
- what proof he collects;
- what he chooses not to reveal;
- how his control becomes more visible.

The protagonist must not feel randomly omnipotent.
He should win through proof, timing, competence, restraint, system logic, legal logic, financial logic, social logic, or enemy self-exposure.

==================================================
12. HIDDEN CARD MAP
==================================================

For each hidden card from Stage 01, define:

- when it is hinted;
- when it is partially revealed;
- when the viewer understands it;
- when the antagonist misunderstands it;
- when the public learns it;
- when it becomes irreversible proof.

Do not reveal final proof too early.

The viewer may know more than the public, but public proof must arrive at the correct dramatic moment.

==================================================
13. SCENE CARD REQUIREMENTS FOR STAGE 03
==================================================

Define what Stage 03 must do with this plan.

Include:

- approximate total scene count;
- recommended scene count per part;
- what scene cards must include;
- which parts need more detailed scene cards;
- which parts must stay compressed;
- how Stage 03 should avoid repeated scene surfaces;
- what surfaces fit the premise DNA;
- what surfaces to avoid;
- what opening surface must be protected.

Stage 03 scene cards must later include:

- scene title;
- part;
- estimated length;
- surface;
- characters;
- purpose;
- conflict;
- action;
- proof / hidden card;
- visible payoff;
- status shift;
- regret / panic;
- protagonist control;
- exit hook;
- repetition risk.

==================================================
14. SCENE SURFACE GUIDANCE FOR STAGE 03
==================================================

Give practical guidance for scene surfaces.

Include:

- surfaces that fit this story’s premise DNA;
- surfaces to avoid by default;
- surface repetition risks;
- public arenas allowed if justified;
- private scenes that should stay short;
- how to vary scene locations without becoming random.

Surfaces must come from the premise DNA.
Do not force unrelated locations just for variety.

==================================================
15. PACING RISK CHECK
==================================================

Check the macro outline for risks.

Answer:

- Does any part feel too setup-heavy?
- Does any part lack visible payoff?
- Are there too many similar payoffs?
- Are face-slaps varied enough?
- Are avatar placements useful and not random?
- Is the antagonist inactive anywhere?
- Does the betrayer regret too early?
- Is the protagonist too passive?
- Is the true ally underused?
- Is any hidden card revealed too early?
- Is final collapse properly prepared?
- Does the outline support one hundred twenty thousand to one hundred thirty thousand characters?
- Does this plan give Stage 03 enough material for scene cards?
- Does this plan give Stage 04 enough writing direction?

For each issue, give a correction note.

==================================================
16. STAGE 02 FINAL DECISION
==================================================

Choose one:

A. APPROVED FOR 03 SCENE CARDS
B. NEEDS LENGTH REDISTRIBUTION
C. NEEDS PAYOFF VARIATION REWORK
D. NEEDS REGRET MOVEMENT REWORK
E. NEEDS ANTAGONIST ESCALATION REWORK
F. NEEDS HIDDEN CARD TIMING REWORK
G. NEEDS AVATAR PLACEMENT REWORK
H. NEEDS SURFACE ORIGINALITY CHECK

Briefly explain the decision.


### HANDOFF PACKAGE

==================================================
17. HANDOFF TO 03 SCENE CARDS
==================================================

Create a compact handoff package.

Include:

- nine-part outline summary;
- target character count per part;
- estimated scene count per part;
- part function list;
- face-slap rhythm map;
- avatar placement plan;
- public payoff map;
- regret movement map;
- antagonist escalation map;
- protagonist control map;
- hidden card map;
- scene card requirements;
- scene surface guidance;
- surfaces to avoid;
- final script writing contract;
- main risks for Stage 03;
- key rule for scene cards.

This handoff is what Stage 03 must use.

==================================================
STYLE RULES
==================================================

Be detailed, structured, and practical.

This stage should be more detailed than Stage 00 and Stage 01.

Do not write poetic prose.
Do not write final script paragraphs.
Do not create full scene cards yet.
Do not write long dialogue.

This is the master plan for the plan.

The producer must be able to read it and understand:

- what happens in each part;
- how long each part should be;
- how each part should feel;
- where face-slaps happen;
- where avatar lines go;
- how regret grows;
- how the antagonist escalates;
- how the protagonist gains control;
- how hidden cards reveal;
- how Stage 03 should create scenes;
- how Stage 04 should later write the script.
`;
  } else if (stageId === 3) {
    prompt = `
You are 03 SCENE CARDS.
${feedback ? `\nUSER CORRECTIONS/FEEDBACK FOR THIS STAGE:\n"${feedback}"\nYou MUST incorporate these corrections into the scene matrix.\n` : ""}

This is Stage 03 of the ScriptForge pipeline.

Your task is to take the approved Stage 02 MACRO OUTLINE handoff and create detailed but compact scene cards for all nine parts.

Do NOT write the final script.
Do NOT write polished prose.
Do NOT rewrite the story from scratch.
Do NOT change locked story DNA, character functions, hidden cards, proof system, avatar placement, or final collapse logic.

This stage is the final structural stage before writing.

The scene cards must be detailed enough for Stage 04 to write the full script without inventing random new plot logic.

==================================================
INPUT
==================================================

Use the approved Stage 02 handoff:

${previousHandoffs["02_macro"] || ""}

The handoff may include:

- nine-part outline summary;
- target character count per part;
- estimated scene count per part;
- part function list;
- face-slap rhythm map;
- avatar placement plan;
- public payoff map;
- regret movement map;
- antagonist escalation map;
- protagonist control map;
- hidden card map;
- scene card requirements;
- scene surface guidance;
- surfaces to avoid;
- final script writing contract;
- main risks for Stage 03;
- key rule for scene cards.

Use this as locked foundation.

If something is missing, infer carefully and mark it as inferred.

==================================================
GLOBAL FINAL SCRIPT CONTRACT TO PRESERVE
==================================================

Stage 04 will later write the final script from these scene cards.

Therefore, Stage 03 must preserve the final writing contract:

Total final script length:
one hundred twenty thousand to one hundred thirty thousand characters including spaces.

Normal paragraph length:
Every normal final-script paragraph must be between one hundred twenty and two hundred twenty characters including spaces.

Numbers:
All numbers must be written as words in the final script.

Symbols:
Currency signs, percent signs, hashtags, slashes, plus signs, equals signs, arrows, decorative signs, and similar symbols must be written as words or removed naturally in the final script.

Part headings:
Use words, not digits.

Avatar rule:
If avatar commentary is enabled, the full final script must include exactly three avatar lines.

Avatar format:
[AVATAR] text

Avatar text length:
The text after the [AVATAR] tag must be between three hundred and four hundred characters including spaces.

Avatar role:
The avatar speaks like a sharp psychologist and strategist.

The avatar explains:
- why a character makes a wrong choice;
- how status pressure manipulates people;
- how betrayal is rationalized;
- how ego forces escalation;
- how fear, shame, envy, greed, or insecurity drives behavior;
- what strategic lesson the viewer should understand.

The avatar must not simply summarize the plot.
The avatar must not spoil future reveals.

Stage 03 must place avatar slots exactly as planned in Stage 02.

==================================================
GOAL OF STAGE 03
==================================================

Create a full scene matrix for all nine parts.

The total scene count should follow the Stage 02 estimate.

Recommended range:
forty five to sixty scenes total.

Each part must have enough scenes to support its target character range.

Every scene must move at least one of these forward:

- proof;
- hidden card timing;
- protagonist control;
- antagonist escalation;
- betrayer regret;
- true ally validation;
- public payoff;
- face-slap rhythm;
- final collapse setup.

No filler scenes.

Do not create repeated scenes where:
- the antagonist only flexes money;
- the protagonist silently watches;
- the crowd laughs the same way;
- the same screen reveal happens again and again;
- the betrayer repeats the same denial without new pressure;
- the true ally only praises the protagonist;
- the enemy only yells without strategy.

==================================================
OUTPUT FORMAT
==================================================

Return your results in exactly TWO separated sections:
1) "### STAGE OUTPUT" followed by sections 1 to 13 of "03 SCENE CARDS".
2) "### HANDOFF PACKAGE" followed by section 14.

### STAGE OUTPUT

==================================================
03 SCENE CARDS
==================================================

1. STAGE 02 HANDOFF RECAP

Briefly restate:

- nine-part story summary;
- target character count per part;
- estimated scene count per part;
- face-slap rhythm;
- avatar placement plan;
- hidden card map;
- proof system;
- regret movement;
- antagonist escalation;
- protagonist control;
- surfaces to avoid;
- key rule for scene cards.

Keep this short.

==================================================
2. TOTAL SCENE STRATEGY
==================================================

Create a scene strategy table.

For each part include:

- part written as word;
- target character range;
- planned scene count;
- average scene length direction;
- drama weight;
- reason for scene count.

Important:
Do not make every part mechanically equal.

High-drama parts may have more scenes.
Setup-heavy parts should stay tighter.

The scene count must support the final script length of one hundred twenty thousand to one hundred thirty thousand characters.

==================================================
3. OPENING SURFACE ORIGINALITY CHECK
==================================================

Before creating scene cards, verify the opening.

Include:

- approved opening surface;
- first visual image;
- first public or social witness group;
- first humiliation method;
- first betrayal action;
- first proof clue;
- first hidden card hint;
- similarity risk: low, medium, or high;
- why it does not repeat generic default openings.

Default openings to avoid unless specifically justified:

- gala;
- red carpet;
- helicopter arrival;
- luxury-store card decline;
- generic billionaire party;
- generic boardroom;
- generic café;
- generic wedding betrayal;
- generic press conference.

End this section with:

PASSED — SCENE CARDS CAN CONTINUE

or

FAILED — OPENING REWORK REQUIRED

If failed, explain what must be changed.

==================================================
4. SCENE SURFACE DIVERSITY PLAN
==================================================

Create a surface plan for the full story.

List the main surfaces that will appear.

For each surface include:

- which parts it appears in;
- why it fits the premise DNA;
- what dramatic function it serves;
- what repetition risk exists;
- how to keep it fresh.

Check:

- Are there too many scenes in the same room?
- Are there too many private planning scenes?
- Are there too many screen-only proof scenes?
- Are there too many generic public humiliation scenes?
- Are there enough premise-specific surfaces?

If there is a risk, correct it before scene cards.

==================================================
5. COMPLETE SCENE CARDS BY PART
==================================================

Create scene cards for all nine parts.

Use the approved scene count from Stage 02 unless a correction is necessary.

For each part use this structure:

==================================================
PART [WORD] — [TITLE]
Target character range:
Planned scene count:
Part function:
Part-level face-slap:
Part-level hidden card movement:
Part-level regret movement:
Part-level antagonist movement:
Part-level protagonist control:
Avatar slot:
Part ending hook:
==================================================

Then create each scene card using this compact format:

SCENE [PART].[SCENE] — [TITLE]

Part:
Estimated final script length:
Surface:
Characters:
Purpose:
Conflict:
Action:
Proof / Hidden Card:
Visible Payoff:
Status Shift:
Regret / Panic:
Protagonist Control:
True Ally Function:
Avatar Use:
Exit Hook:
Repetition Risk:

==================================================
SCENE CARD FIELD RULES
==================================================

Estimated final script length:
Give a rough character range for the scene.
Example:
two thousand to two thousand five hundred characters.

Surface:
The physical or social scene surface.
It must come from premise DNA.
Do not use random unrelated locations just for variety.

Characters:
List only important characters in the scene.

Purpose:
What this scene does structurally.

Conflict:
The central pressure of the scene.

Action:
What happens in clear practical terms.

Proof / Hidden Card:
What proof is shown, hinted, misunderstood, protected, or saved.

Visible Payoff:
What dopamine reward the viewer receives.
Not every scene needs a huge face-slap, but every scene needs tension, proof, status shift, or forward motion.

Status Shift:
Who gains status?
Who loses status?
Who only appears to gain status?

Regret / Panic:
How the betrayer’s regret or antagonist’s panic moves in this scene.

Protagonist Control:
What the protagonist appears to lose and what he actually gains.

True Ally Function:
What the true ally notices, tests, validates, helps, or whether they are absent.

Avatar Use:
State one of:
No avatar.
Avatar One.
Avatar Two.
Avatar Three.

If this scene contains an avatar, define:
- avatar topic;
- psychological or strategic lesson;
- what it must not spoil.

Exit Hook:
How the scene pushes into the next scene.

Repetition Risk:
What this scene might accidentally repeat and how to avoid it.

==================================================
6. FACE-SLAP DISTRIBUTION CHECK
==================================================

Create a table across all scenes or parts.

Include:

- part;
- scene;
- payoff type;
- face-slap size: minor, medium, major, final;
- who witnesses it;
- false belief attacked;
- proof or action causing it;
- repetition risk.

Rules:

Every part must have visible payoff.
Major face-slaps should appear at key turning points.
Do not repeat the same face-slap mechanic three or more times.
Do not make every payoff social humiliation.
Do not make every payoff a screen reveal.

==================================================
7. AVATAR SLOT CHECK
==================================================

Verify exactly three avatar slots.

For each avatar include:

- avatar number;
- part;
- scene;
- topic;
- psychological or strategic lesson;
- why this moment is useful;
- what it must not spoil.

Rules:

Avatar One usually appears after first betrayal or wrong choice.
Avatar Two usually appears around midpoint panic, ego defense, or regret crack.
Avatar Three usually appears near final collapse or final authority lesson.

The avatar must explain human behavior.
The avatar must not summarize the plot.
The avatar must not reveal hidden cards early.

==================================================
8. HIDDEN CARD TIMING CHECK
==================================================

For each hidden card, create a timing table.

Include:

- hidden card;
- hint scenes;
- partial reveal scenes;
- viewer understanding scene;
- public reveal scene;
- irreversible proof scene;
- must not reveal before scene.

Confirm:

- final proof is not revealed too early;
- public reveal happens at the planned moment;
- antagonist misunderstands until the correct moment;
- viewer gets enough information to feel smart without killing tension.

==================================================
9. REGRET AND PANIC TRACK
==================================================

Create two tracks across all nine parts:

A. Betrayer regret track.
B. Antagonist panic / escalation track.

For each part include:

- betrayer state;
- what changes;
- antagonist state;
- what escalates;
- how this appears in scenes.

Check:

- regret does not happen too early;
- panic grows logically;
- antagonist does not become useless too soon;
- betrayer does not receive cheap forgiveness;
- both tracks are visible in scenes, not only described abstractly.

==================================================
10. PROTAGONIST CONTROL TRACK
==================================================

For each part include:

- what protagonist appears to lose;
- what protagonist actually gains;
- what proof he collects;
- what he chooses not to reveal;
- how control becomes more visible.

Check:

- protagonist does not feel randomly omnipotent;
- protagonist has restraint, cost, or limitation;
- protagonist wins through preparation, proof, timing, competence, system logic, legal logic, financial logic, social logic, or enemy self-exposure.

==================================================
11. DIALOGUE AND EXPOSITION CONTROL
==================================================

Flag scenes that risk becoming too dialogue-heavy.

For each risky scene include:

- what should be shown visually;
- what dialogue should stay short;
- what must not become a monologue;
- what proof object or action should carry the scene.

Important:
Stage 04 must not turn technical, legal, financial, system, or emotional logic into long speeches if visual proof can carry it.

==================================================
12. FINAL SCRIPT READINESS CHECK
==================================================

Answer:

- Are all nine parts covered?
- Does every part have the planned number of scenes?
- Does every scene have a clear purpose?
- Does every part have visible payoff?
- Are face-slaps varied?
- Are avatar slots exactly three?
- Are hidden cards timed correctly?
- Is regret gradual?
- Is antagonist escalation logical?
- Is protagonist control believable?
- Are scene surfaces varied and premise-specific?
- Does the scene matrix support one hundred twenty thousand to one hundred thirty thousand characters?
- Does Stage 04 have enough information to write the final script part by part?

For every issue, give a correction note.

==================================================
13. STAGE 03 FINAL DECISION
==================================================

Choose one:

A. APPROVED FOR 04 FINAL SCRIPT
B. NEEDS OPENING REWORK
C. NEEDS SURFACE DIVERSITY REWORK
D. NEEDS PAYOFF VARIATION REWORK
E. NEEDS AVATAR SLOT REWORK
F. NEEDS HIDDEN CARD TIMING REWORK
G. NEEDS REGRET / PANIC REWORK
H. NEEDS SCENE FUNCTION REWORK

Briefly explain the decision.


### HANDOFF PACKAGE

==================================================
14. HANDOFF TO 04 FINAL SCRIPT
==================================================

Create a compact handoff package.

Include:

- total scene count;
- scene count by part;
- approved opening fingerprint;
- complete scene matrix summary;
- full scene cards or scene card references;
- target character count per part;
- face-slap distribution;
- avatar slot plan;
- key proof objects;
- hidden card timing;
- regret and panic tracks;
- protagonist control notes;
- scene surface rules;
- dialogue and exposition warnings;
- final script writing contract;
- main risks for Stage 04;
- key rule for final script.

This handoff is what Stage 04 must use.

==================================================
STYLE RULES
==================================================

Be structured, practical, and specific.

Do not write final prose.
Do not write full dialogue.
Do not write poetic descriptions.
Do not make scene cards bloated.

Scene cards must be detailed enough for writing, but compact enough for a producer to read.

This is the final structural blueprint before the script is written.

Stage 04 must be able to write the script from these scene cards without inventing new major plot logic.
`;
  } else {
    return res.status(400).json({ error: "Invalid stage ID for standard generation." });
  }

  let modelToUse = "gemini-2.5-flash";
  let thinkingLevelToUse = undefined;
  
  if (stageId === 0) {
    modelToUse = "gemini-2.5-flash";
  } else if (stageId === 1) {
    modelToUse = "gemini-2.5-flash";
  } else if (stageId === 2) {
    modelToUse = "gemini-2.5-pro";
  } else if (stageId === 3) {
    modelToUse = "gemini-2.5-pro";
  }

  prompt += `\n\n${globalPipelineDriftPreventionPatch}\n\n${storyLogicCorePatch}`;
  if (stageId === 2 || stageId === 3) {
    prompt += `\n\n${preStageContinuityGate}`;
  }
  if (stageId === 3) {
    prompt += `\n\n${stage03DriftDetector}`;
  }
  
  if (masterPromptInjection) {
    prompt += `\n\n${masterPromptInjection}`;
  }

  try {
    const responseText = await generateText(prompt, systemInstruction, modelToUse, thinkingLevelToUse);
    
    // Parse response into Output and Handoff
    let output = "";
    let handoff = "";

    const outputMarker = "### STAGE OUTPUT";
    const handoffMarker = "### HANDOFF PACKAGE";

    const outputIdx = responseText.indexOf(outputMarker);
    const handoffIdx = responseText.indexOf(handoffMarker);

    if (outputIdx !== -1 && handoffIdx !== -1) {
      if (outputIdx < handoffIdx) {
        output = responseText.slice(outputIdx + outputMarker.length, handoffIdx).trim();
        handoff = responseText.slice(handoffIdx + handoffMarker.length).trim();
      } else {
        handoff = responseText.slice(handoffIdx + handoffMarker.length, outputIdx).trim();
        output = responseText.slice(outputIdx + outputMarker.length).trim();
      }
    } else {
      // Fallback if formatting was slightly missed
      const parts = responseText.split("###");
      output = responseText;
      handoff = "Handoff details generated inside stage output text. Please review.";
    }

    res.json({ output, handoff });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stage 04: Generate individual part of the final script
app.post("/api/generate-script-part", async (req, res) => {
  const { partNumber, partTitle, sceneCardsHandoff, previousPartsOutput, avatarCommentaryEnabled, outputLanguage, competitorScriptsText, competitorBlueprint, feedback } = req.body;

  if (!sceneCardsHandoff) {
    return res.status(400).json({ error: "Scene cards handoff context is required." });
  }
  
  const masterPromptInjection = competitorBlueprint ? `\n==================================================\nMASTER PROMPT / REFERENCE BLUEPRINT\n==================================================\nThe user has provided the following Master Prompt:\n${competitorBlueprint}\n\nSTRICT LAW: You MUST obey the stylistic instructions, world-building rules, and narrative mechanisms specified in this Master Prompt. It is the ultimate authority for how this specific niche should be developed.\n` : "";


  const systemInstruction = 
    "You are ScriptForge Finalizer, an elite long-form YouTube drama scriptwriter. " +
    "You write incredibly slow-burn, hyper-detailed, high-tension scripts part-by-part. " +
    "You follow mechanical formatting rules with absolute, literal robotic precision. " +
    "STRICT STYLE RULE: Avoid flowery artistic metaphors, purple prose, or unnecessary 'literary' words to fill character counts. " +
    "STRICT REPETITION RULE: Do NOT repeat catchphrases, hooks, or specific emotional descriptions from previous parts. " +
    "Avoid overused tropes like 'face paws' or 'cold smiles' unless essential. Use the plan and memory of previous parts to keep the story moving forward without circling back.";

  const previousContext = previousPartsOutput && previousPartsOutput.length > 0
    ? `PREVIOUS PARTS GENERATED OR COMPLETED (use as tight narrative, pacing, and tone flow):
---
${previousPartsOutput.join("\n\n")}
---`
    : "No previous parts written yet. This is PART ONE. Establish the exact aesthetic, surface, and voice.";

  const feedbackBlock = feedback ? `
USER CORRECTIONS/FEEDBACK FOR THIS PART:
"${feedback}"
You MUST explicitly follow these instructions while writing this part.
` : "";

  const projectVocabularyProfileText = `
==================================================
PROJECT VOCABULARY PROFILE
==================================================

Before Stage 04, create a short project vocabulary profile.

Approved genre:
Refer to Stage 03 Handoff.

Approved setting:
Refer to Stage 03 Handoff.

Approved power source:
Refer to Stage 03 Handoff.

Approved proof style:
Refer to Stage 03 Handoff.

Replacement direction:
Use vocabulary perfectly aligned with the established domain.
Do NOT import terms from unrelated genres (e.g. cyber into pseudo-historical).
`;

  // Avatar rules injection: Part 3, 6, and 9 will strictly trigger the exactly three avatar lines across the entire script!
  let avatarInstruction = "";
  if (avatarCommentaryEnabled && (partNumber === 3 || partNumber === 6 || partNumber === 9)) {
    avatarInstruction = `
CRITICAL CORE AVATAR RULE:
For this part, you MUST include EXACTLY ONE strategic, psychological and philosophical commentary block styled precisely as:
[AVATAR] <commentary text>

THE AVATAR TEXT AFTER THE TAG MUST BE BETWEEN THREE HUNDRED (300) AND FOUR HUNDRED (400) CHARACTERS INCLUDING SPACES. (NEVER less than 300, NEVER more than 400).
The avatar speaks like a sharp psychologist and master strategist.
It explains why characters make wrong choices under status pressure, how the ego forces people into inescapable escalation traps, how betrayal becomes rationalized, and what structural lesson the viewer should absorb.
Do NOT summarize the plot. Do NOT spoil future reveals. Just dive into deep philosophical/strategic analysis of human hubris.
`;
  } else {
    avatarInstruction = "Do NOT include any avatar tags or [AVATAR] lines in this part.";
  }

  const competitorStyleBlock = competitorScriptsText && competitorScriptsText.trim() !== "" ? `
==================================================
OPTIONAL COMPETITOR STYLE INGESTION FOR STAGE 04
==================================================

Optional input:

COMPETITOR_SCRIPT_EXAMPLES:
${competitorScriptsText}

If competitor script examples are provided, analyze them internally before writing the final script.

Do NOT output the analysis unless the user explicitly requests it.

Use competitor examples only to extract an internal writing style blueprint.

Extract only:

- hook rhythm;
- first conflict timing;
- opening pressure;
- protagonist voice;
- narration speed;
- paragraph rhythm;
- dialogue density;
- face-slap frequency;
- dopamine beat frequency;
- antagonist escalation style;
- betrayer regret timing;
- proof reveal rhythm;
- final collapse pacing;
- emotional intensity;
- how the script keeps viewers watching.

Do NOT copy:

- plot;
- characters;
- names;
- locations;
- exact scenes;
- exact openings;
- exact dialogue;
- proof objects;
- twists;
- final collapse events;
- unique worldbuilding terms;
- scene choreography.

Core rule:

Match competitor rhythm.
Do not copy competitor content.

==================================================
INTERNAL STYLE EXTRACTION STEPS
==================================================

Before writing, silently extract:

1. Hook Pattern:
How quickly the competitor creates conflict, humiliation, betrayal, hidden power, or status gap.

2. Early Retention Pattern:
How the first section makes the viewer angry, curious, or satisfied.

3. Dopamine Beat Pattern:
How often the competitor gives small rewards, proof clues, enemy mistakes, regret cracks, or public reversals.

4. Face-Slap Pattern:
How the competitor makes enemies lose status publicly or emotionally.

5. Protagonist Voice:
How calm, sharp, emotional, or strategic the protagonist sounds.

6. Antagonist Pattern:
How enemies escalate, overperform, panic, or self-destruct.

7. Betrayer Regret Pattern:
When regret begins, how slowly it grows, and what proof makes it stronger.

8. Dialogue Pattern:
Whether dialogue is short, sharp, insulting, threatening, strategic, or explanatory.

9. Narration Pattern:
How fast scenes move, how much internal thought is used, and how visual the narration is.

10. Final Collapse Pattern:
How the ending turns earlier enemy actions into consequences.

Then use these extracted patterns as style guidance only.

Do not mention the competitor scripts inside the final script.

Do not create scenes from the competitor examples.

Do not replace the approved Stage 03 scene cards.

The approved Stage 03 scene cards remain the story source of truth.

==================================================
HOW TO APPLY COMPETITOR STYLE
==================================================

When writing the final script, apply competitor influence only in these ways:

- stronger opening pressure;
- faster conflict entry;
- clearer injustice;
- more frequent small dopamine beats;
- sharper public status reversals;
- stronger protagonist inner control;
- more hateable but logical antagonist behavior;
- slower betrayer regret;
- shorter and sharper dialogue;
- more visible proof moments;
- stronger end-of-part hooks;
- cleaner escalation toward final collapse.

Do not apply competitor influence by copying their:

- setting;
- plot path;
- character roles;
- exact revenge method;
- exact betrayal setup;
- exact proof system;
- exact final punishment.

If competitor style conflicts with approved Stage 03 scene cards, follow Stage 03.

If competitor style conflicts with hidden card timing, follow hidden card timing.

If competitor style conflicts with safety, originality, or platform compliance, follow originality and compliance.

==================================================
ANTI-COPY SAFETY CHECK BEFORE WRITING
==================================================

Before writing, silently check:

- Am I using competitor rhythm rather than competitor plot?
- Are all scenes still from approved Stage 03?
- Are names, locations, proof objects, and final collapse original to this project?
- Did I avoid copying exact dialogue or scene choreography?
- Did I preserve our hidden cards and proof system?
- Did I preserve our avatar plan?
- Did I preserve our final collapse logic?

If any competitor influence becomes too close to copied content, rewrite it into an abstract equivalent.

Example:

Do not copy:
A competitor starts with a billionaire arriving at a red carpet gala and humiliating the hero.

Allowed abstraction:
Start with immediate public status imbalance and humiliation, but use our own premise-specific surface, such as a startup demo interface override.

Function can transfer.
Surface must be original.
` : `You do NOT see competitor scripts now, so you must follow the built-in style rules below.`;

  const prompt = `
You are 04 FINAL SCRIPT.

This is Stage 04 of the ScriptForge pipeline.

Your task is to write the final long-form YouTube drama recap script from the approved Stage 03 Scene Cards.

You must write in a high-retention drama recap style similar to successful manhwa / system revenge / power fantasy recap channels.

${competitorStyleBlock}

The goal is to create a script that feels addictive, fast, emotional, easy to narrate, and full of visible payoff.

${feedbackBlock}

${projectVocabularyProfileText}

==================================================
INPUT
==================================================

Use the approved Stage 03 handoff:
${sceneCardsHandoff}

Use the current part scene cards:
Focus specifically on writing the scenes designated for "${partTitle}" (Part Number: ${partNumber}) inside the handoff shown above.

Use previous continuity summary if this is not Part One:
${previousContext}

Use avatar count state:
Avatar Commentary Enabled: ${avatarCommentaryEnabled ? "YES" : "NO"}
We are writing Part Number: ${partNumber}. If avatar commentary is enabled, the full script across all parts must contain exactly three avatar lines, placed in Parts Three, Six, and Nine.
If this part number matches one of those, you must write exactly one [AVATAR] block here following the exact instructions below. Otherwise, write zero [AVATAR] lines.

Use output language:
${outputLanguage || "Russian"}

Use the approved:
- story DNA;
- scene cards;
- hidden card timing;
- proof system;
- face-slap distribution;
- avatar placement;
- regret track;
- antagonist escalation;
- protagonist control notes;
- final writing contract.

Do NOT invent a new story.
Do NOT add new major scenes.
Do NOT change character names.
Do NOT change locked relationships.
Do NOT change the opening.
Do NOT reveal hidden cards earlier than planned.
Do NOT move avatar lines unless the Stage 03 handoff allows it.
Do NOT skip approved scenes.

==================================================
CORE TASK
==================================================

Write the final script text for the requested part: ${partTitle} (Part Number: ${partNumber}).

Write only this requested part. The output should be the direct audience-facing script narration.

==================================================
FINAL SCRIPT LENGTH CONTRACT (CHARACTERS & WORD TARGETS)
==================================================

Full final script target is 120,000 to 130,000 characters including spaces (approximately 16,000 to 17,500 Russian words globally).
For this individual part (${partTitle}), the target length is STRICTLY between twelve thousand (12,000) and fourteen thousand (14,000) characters including spaces, which corresponds to exactly sixteen hundred (1,600) to nineteen hundred (1,900) Russian words.

Do not compress this part far below target. You MUST write enough detail, actions, dialogues, hacking procedures, and SEO corporate sabotage details to fully reach at least 1,600 to 1,900 words.
Do not overwrite this part far above target (maximum 1,950 words).

Focus on writing between 1,600 and 1,900 words (twelve thousand to fourteen thousand characters) for this part.
Every scene from ${partTitle} should receive enough writing weight to support the target.
High-drama scenes should be expanded more.
Transition scenes should stay efficient.
Do not add filler just to reach length.
Expand through:
- visible proof;
- character reaction;
- status shift;
- public pressure;
- regret movement;
- antagonist panic;
- protagonist observation;
- consequence;
- payoff setup.

==================================================
STRICT PARAGRAPH LENGTH RULE (CHARACTERS & WORD RANGE)
==================================================

Every normal script paragraph must be between sixteen (16) and thirty (30) words, which corresponds to exactly one hundred twenty (120) to two hundred twenty (220) characters including spaces.

This rule is strict.

Do not write short punch-line paragraphs under 16 words (or under 120 characters).

Bad:
My hand froze.

Good:
My hand froze, not because I was afraid, but because Damon had just exposed the one rule he never understood.

Do not write paragraphs longer than two hundred twenty characters.

If a paragraph is too long, split it naturally.

If a paragraph is too short, expand it with:
- action;
- reaction;
- proof;
- sensory detail;
- status shift;
- emotional consequence.

Do not add meaningless filler.

Avatar lines have their own separate length rule.

==================================================
VOICEOVER TEXT NORMALIZATION
==================================================

The final script must be clean for voiceover.

Write all numbers as words.

Do not write digits.

Bad:
He waited 3 minutes.

Good:
He waited three minutes.

Bad:
Level 7.

Good:
level seven.

Bad:
$100,000,000.

Good:
one hundred million dollars.

Bad:
70%.

Good:
seventy percent.

Do not use symbols such as:
currency signs, percent signs, hashtags, slashes, plus signs, equals signs, arrows, decorative separators, emojis, or excessive punctuation.

Write symbols as words when needed.

Bad:
A/B test.

Good:
A B test.

Bad:
User #1.

Good:
user number one.

Bad:
admin@system.

Good:
admin account.

The only allowed bracketed tag is:

[AVATAR]

Do not use decorative formatting inside the script.

==================================================
PART HEADING RULE
==================================================

Use part headings in words, not digits.

Correct:
${partTitle.toUpperCase()}

Inside the final script, do not include:
- scene labels;
- stage labels;
- planning notes;
- bullet points;
- tables;
- checklist items;
- estimated length notes;
- hidden card labels;
- proof system labels.

Scene cards are for planning only.
The audience must see only polished narration.

==================================================
POV RULE
==================================================

Default POV:
First-person protagonist POV.

Use first person unless Stage 03 explicitly says another POV is locked.

The protagonist should narrate what he sees, understands, hides, loses, and gains.

The narration should feel like:
- controlled;
- sharp;
- observant;
- emotional but not melodramatic;
- strategic;
- easy to follow;
- direct;
- addictive.

The protagonist can feel pain, but he must not beg for long.
He can be calm, but not robotic.
He can be strategic, but not instantly omnipotent.

Default protagonist voice:
I saw more than they thought.
I stayed silent because proof was worth more than anger.
I let them celebrate because every celebration created another record.

Do not overuse these exact lines.
Use this voice direction, not these exact sentences.

==================================================
COMPETITOR-STYLE RETENTION RULES
==================================================

Write with the rhythm of high-performing drama recap scripts.

The script must feel like emotional acceleration:

injustice
→ wrong choice
→ hidden advantage
→ first crack
→ small payoff
→ enemy escalation
→ bigger proof
→ regret crack
→ public face-slap
→ final collapse

The viewer should never feel that the story is waiting too long.

Every few paragraphs should provide at least one of:
- new pressure;
- visible status shift;
- proof clue;
- enemy arrogance;
- protagonist observation;
- regret movement;
- public reaction;
- small dopamine payoff;
- future threat;
- hidden card tension.

Avoid long quiet exposition.

Do not spend many paragraphs explaining background before conflict.
Start with active conflict, public pressure, betrayal, or a strong status gap.

If this is Part One, the first page of the script must include:
- a visible conflict;
- a reason to hate or distrust the antagonist;
- a reason to care about the protagonist;
- a first proof clue or hidden advantage;
- a status imbalance.

==================================================
OPENING RULE
==================================================

If this is Part One, the opening must use the approved opening fingerprint from Stage 03.

Do not replace it with:
- gala;
- red carpet;
- helicopter arrival;
- luxury party;
- generic boardroom;
- generic café;
- generic wedding betrayal;
- generic press conference;
- luxury-store card decline.

Unless Stage 03 explicitly approved that surface.

For tech or system stories, opening surfaces should come from:
- startup demo;
- interface reveal;
- investor pitch;
- access control;
- public product launch;
- system dashboard;
- code review;
- platform authority;
- public admin review.

The first scene must show the story’s specific premise DNA, not a generic rich revenge setup.

==================================================
FACE-SLAP WRITING RULES
==================================================

Every part must contain visible payoff.

Not every payoff must be huge.
But every part needs a reward for the viewer.

Face-slaps can be:
- social;
- romantic;
- technical;
- financial;
- legal;
- professional;
- institutional;
- public proof;
- final systemic.

A good face-slap must include:
- what false belief is being attacked;
- who witnesses it;
- what proof or action causes it;
- who gains status;
- who loses status;
- what new problem it creates.

Do not make every face-slap the same.

Bad repetition:
Damon buys something.
Kai silently smiles.
The crowd laughs.
Mira looks shocked.
Repeat.

Better progression:
Damon wins public attention.
Kai sees hidden debt.
Selena tests the architecture.
Damon fails a technical command.
Mira signs liability.
The system freezes in public.
Debt conversion destroys the fake identity.

Face-slaps should come from the premise logic, not random humiliation.

==================================================
DOPAMINE BEAT RULE
==================================================

Each scene should contain at least one dopamine beat.

A dopamine beat can be:
- hidden proof clue;
- enemy mistake;
- protagonist prediction;
- betrayer doubt;
- true ally recognition;
- public status reversal;
- system warning;
- access failure;
- contract reveal;
- enemy panic;
- crowd shift;
- final proof.

Small dopamine beats should appear between major face-slaps.

Do not wait until the end of the part to give all payoff.

The viewer should constantly feel:
something is being exposed,
someone is losing control,
or the protagonist knows more than the room.

==================================================
DIALOGUE RULES
==================================================

Dialogue must be short, sharp, and purposeful.

Do not write long dialogue blocks.

Dialogue should create:
- status pressure;
- humiliation;
- panic;
- proof;
- betrayal;
- regret;
- threat;
- reversal.

Use dialogue like a blade, not like an explanation.

Good style:
I told her she had chosen the title, not the truth.

Good direct line:
I said, you chose his name. Now carry his debt.

Bad:
Long speeches where characters explain the entire system, their feelings, and the plot.

Avoid quotation marks by default.
Write dialogue naturally for narration.

Preferred:
Damon told the room I was just an NPC who had confused effort with talent.

Allowed:
I said, you chose his name. Now carry his debt.

Do not use fake stuttering:
S-sorry...
I-I didn’t...

Instead write:
Mira tried to speak, but the confidence she had practiced all week collapsed before the first word.

==================================================
NARRATION STYLE
==================================================

Use strong, clear, cinematic recap narration.

The style should be:
- fast but understandable;
- dramatic but not purple;
- emotional but not melodramatic;
- direct but not flat;
- visual;
- status-driven;
- proof-driven.

Avoid:
- long literary metaphors;
- poetic fog;
- abstract philosophy;
- generic AI phrases;
- empty “in that moment” lines;
- repeated cold smiles;
- repeated room froze;
- repeated everyone gasped;
- repeated he clenched his fists;
- repeated she turned pale;
- repeated my phone buzzed;
- repeated the screen lit up.

These phrases are not absolutely banned, but they must not become default filler.

Replace generic reactions with specific behavior.

Bad:
The room froze.

Better:
No one moved toward the screen. Even the investor holding Damon’s contract stopped before signing his name.

Bad:
Mira turned pale.

Better:
Mira looked at Damon first, as if his face could deny the numbers before she had to believe them.

==================================================
PROTAGONIST WRITING RULES
==================================================

The protagonist must not feel randomly omnipotent.

He should win through:
- proof;
- timing;
- restraint;
- competence;
- system logic;
- legal logic;
- financial logic;
- social logic;
- enemy self-exposure.

He should not reveal everything too early.

He should often appear to lose publicly while gaining proof privately.

He should not beg for the betrayer.
He should not overexplain his plan.
He should not smile silently every time.

Show his control through:
- what he notices;
- what he refuses to reveal;
- what he records;
- what he predicts;
- what the enemy accidentally confirms;
- what the true ally begins to understand.

He can feel pain.
He can feel anger.
He can hesitate when innocent people might be hurt.
But he must remain strategically coherent.

==================================================
ANTAGONIST WRITING RULES
==================================================

The antagonist must be hateable but not stupid.

They should have:
- public mask;
- temporary power;
- false belief;
- social confidence;
- ego;
- reason to escalate.

Their actions must make sense from their point of view.

They should lose because:
- they overcommit;
- they abuse power;
- they misunderstand rules;
- they steal what they cannot control;
- they attack the witness;
- they create public proof against themselves.

Do not make the antagonist simply scream in every scene.
Vary their behavior:
- charm;
- mockery;
- confidence;
- forced calm;
- blame-shifting;
- public performance;
- legal pressure;
- desperation;
- panic.

==================================================
BETRAYER WRITING RULES
==================================================

The betrayer must not regret too early.

Their regret should move gradually:

arrogance
→ irritation
→ doubt
→ denial
→ fear
→ proof shock
→ bargaining
→ rejection
→ consequence

Early betrayal should feel understandable from their selfish viewpoint, but morally ugly.

The betrayer should rationalize the wrong choice before breaking.

Do not let the betrayer apologize too early.
Do not give cheap forgiveness.
Do not make the protagonist accept them back after proof appears.

Regret should be shown through:
- defensive explanations;
- watching the antagonist fail;
- comparing the hero’s calm with enemy panic;
- fear of losing chosen status;
- realizing their own signature or choice created consequence.

==================================================
TRUE ALLY WRITING RULES
==================================================

The true ally must not be just a new romantic prize.

Their function is:
- recognition;
- testing;
- validation;
- proof access;
- credibility;
- contrast with the betrayer.

The true ally should challenge the protagonist, not worship him instantly.

They should notice what others miss.
They should ask precise questions.
They should validate proof at the right time.

Romantic tension may exist only if it does not replace their proof function.

==================================================
HIDDEN CARD RULES
==================================================

Follow the hidden card timing from Stage 03 exactly.

The viewer may understand more than the public.
The antagonist should misunderstand until the scheduled reveal.
The public proof must arrive at the planned moment.

Do not reveal:
- full hidden identity too early;
- final proof too early;
- complete debt logic too early;
- true ally confirmation too early;
- final collapse mechanism too early.

Build anticipation through hints:
- interface details;
- contract language;
- failed access;
- warnings;
- timestamps;
- signatures;
- repeated enemy mistakes.

When the reveal comes, it must feel earned, not random.

==================================================
PROOF WRITING RULES
==================================================

Truth must be visual.

Use concrete proof objects:
- screens;
- logs;
- signatures;
- contracts;
- timestamps;
- access denials;
- transaction histories;
- ownership records;
- system messages;
- live failures;
- public reviews.

Do not rely only on narration saying:
I knew the truth.
He was lying.
Everyone understood.

Show proof through visible change.

Example:
The reward line did not disappear. It folded open, revealing a second line Damon had never read: conditional benefit pending liability review.

Proof should often create a new problem.
A reveal should not only solve tension; it should escalate.

==================================================
AVATAR RULE
==================================================

If avatar commentary is enabled and this part requires it (Parts Three, Six, and Nine), you MUST include EXACTLY ONE strategic, psychological and philosophical commentary block styled precisely as:

[AVATAR] <commentary text>

Do not use multiple avatar lines in this single part.
Do not write anything else inside or beside the bracketed tag.

The avatar text after the tag must be between three hundred and four hundred characters including spaces.

The tag itself does not count toward the length.

Avatar lines are exempt from the normal one hundred twenty to two hundred twenty character paragraph rule.

The avatar speaks like a sharp psychologist and strategist.

The avatar explains the hidden human logic behind the scene:
- why a character makes a wrong choice;
- how status pressure manipulates people;
- how betrayal is rationalized;
- how ego forces escalation;
- how fear, shame, envy, greed, or insecurity drives behavior;
- what strategic lesson the viewer should understand.

The avatar must not simply summarize the plot.
The avatar must not spoil future reveals.

${avatarInstruction}

==================================================
PART CONTINUITY RULES
==================================================

If writing Part One:
Introduce the story through the approved opening.
Do not start with backstory dump.
Do not reveal final hidden identity early.

If writing later parts:
Use previous parts summary to flow continuously.
Do not restart the story.
Do not reintroduce characters as if the viewer forgot them.
Continue emotional and proof progression from the previous part.

Each part should end with a hook.

A good ending hook:
- reveals a new danger;
- creates a new proof question;
- forces the enemy to escalate;
- pushes the betrayer toward doubt;
- moves toward final collapse.

Do not end parts with flat closure unless it is Part Nine.

==================================================
SCENE EXECUTION RULE
==================================================

For each approved scene card of this part, write the scene as audience-facing narration.

Do not mention scene titles, scene purpose, status shift fields, or stage labels.
Convert those into natural narration.

Each scene should include:
- surface;
- characters;
- conflict;
- action;
- proof or hidden card movement;
- visible payoff;
- status shift;
- regret or panic movement;
- protagonist control;
- exit hook.

Do not skip scene cards. Do not merge them.

==================================================
ANTI-REPETITION RULES
==================================================

Avoid repeating:
- same opening rhythm;
- same insult;
- same crowd reaction;
- same screen reveal;
- same protagonist silence;
- same enemy panic;
- same betrayer denial;
- same proof object;
- same face-slap mechanic.

If two scenes use a screen, make them different:
- one screen shows access denial;
- one shows liability language;
- one shows failed command;
- one shows signature chain;
- one shows final admin review.

If two scenes include public humiliation, make the humiliation attack different false beliefs:
- status;
- intelligence;
- wealth;
- loyalty;
- legality;
- authority.

==================================================
FINAL COLLAPSE WRITING RULES
==================================================

The final collapse (if this is Part Nine) must use proof seeded earlier.
No random last-minute evidence.
Connect:
- protagonist hidden advantage;
- antagonist false belief;
- betrayer wrong choice;
- hidden cards;
- proof objects;
- true ally validation;
- public witnesses;
- irreversible consequence.

The enemy must collapse through their own actions.
The betrayer must face consequence for their choice.
The protagonist must regain dignity, not just revenge.
No cheap forgiveness.

==================================================
OUTPUT RULES
==================================================

You MUST output exactly two sections separated by markers.

### SCRIPT_OUTPUT_START
In ${outputLanguage || "Russian"}, begin writing ${partTitle} with the exact heading "${partTitle.toUpperCase()}" on the very first line. Do not preface it with introductory remarks or commentary. Output only the final script narration. No analysis, tables, or notes.

### MEMORY_START
Write a concise but critical bulleted list (in Russian) summarizing this part. List exact hooks used, specific emotional beats consumed, metaphors applied, and precise plot points covered. This serves as your continuous memory to strictly PREVENT repeating the exact same stylistic tricks, face slaps, or reaction notes in subsequent parts.
`;

  let finalPrompt = prompt + `\n\n${globalPipelineDriftPreventionPatch}\n\n${storyLogicCorePatch}\n\n${globalVoiceoverCleanlinessPatch}\n\n${domainVocabularyLock}\n\n${noBlindReplacementRule}\n\n${finalScriptResidueBan}\n\n${highDensityWritingPatch}\n\n${firstPersonShortFormStylePatch}\n\n${antiSlopAdjectivePatch}`;
  
  if (masterPromptInjection) {
      finalPrompt += `\n\n${masterPromptInjection}`;
  }

  try {
    const rawResponse = await generateText(finalPrompt, systemInstruction, "gemini-3.1-pro-preview", "HIGH");
    
    let partOutput = rawResponse;
    let memory = "";

    const scriptMarker = "### SCRIPT_OUTPUT_START";
    const memoryMarker = "### MEMORY_START";

    const scriptIdx = rawResponse.indexOf(scriptMarker);
    const memoryIdx = rawResponse.indexOf(memoryMarker);

    if (scriptIdx !== -1 && memoryIdx !== -1) {
      if (scriptIdx < memoryIdx) {
        partOutput = rawResponse.slice(scriptIdx + scriptMarker.length, memoryIdx).trim();
        memory = rawResponse.slice(memoryIdx + memoryMarker.length).trim();
      } else {
        memory = rawResponse.slice(memoryIdx + memoryMarker.length, scriptIdx).trim();
        partOutput = rawResponse.slice(scriptIdx + scriptMarker.length).trim();
      }
    } else {
      // Fallback
      partOutput = rawResponse.replace(scriptMarker, "").replace(memoryMarker, "").trim();
      memory = "No structural memory parsed.";
    }

    res.json({ output: partOutput, memory: memory });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stage 05: Linter QA audits and repair
app.post("/api/run-linter-qa", async (req, res) => {
  const { 
    fullScript, 
    stage03Handoff, 
    stage02Handoff, 
    stage01Handoff, 
    stage00Handoff 
  } = req.body;

  if (!fullScript || fullScript.trim() === "") {
    return res.status(400).json({ error: "Script content is empty." });
  }

  const systemInstruction = 
    "You are the ScriptForge Linter QA, a strict automated syntax auditor, script editor, and mechanical parser.";

  const prompt = `
You are 05 LINTER / QA.

This is Stage 05 of the ScriptForge pipeline.

Your task is to audit the completed Stage 04 FINAL SCRIPT against the approved Stage 03 Scene Cards and all final writing rules.

You are the final quality-control stage before publication.

Do NOT create a new story.
Do NOT rewrite the whole script by default.
Do NOT change the plot.
Do NOT add new scenes.
Do NOT change character names.
Do NOT change hidden card timing.
Do NOT change the final collapse logic.
Do NOT turn this into a new script generation stage.

Your job is to:
- check the script;
- find rule violations;
- identify weak sections;
- repair only broken parts;
- certify whether the script is ready.

==================================================
INPUT
==================================================

Use the completed Stage 04 final script:

${fullScript}

Use the approved Stage 03 handoff:

${stage03Handoff || "None provided"}

Use Stage 02 handoff if needed:

${stage02Handoff || "None provided"}

Use Stage 01 handoff if needed:

${stage01Handoff || "None provided"}

Use Stage 00 handoff if needed:

${stage00Handoff || "None provided"}

Use these as locked truth.

The final script must be judged against the approved pipeline, not as a random standalone story.

==================================================
CORE QA PRINCIPLE
==================================================

The final script must be:

- structurally faithful;
- voiceover-friendly;
- high-retention;
- non-repetitive;
- logically consistent;
- emotionally addictive;
- proof-driven;
- clear in first-person POV unless another POV was approved;
- ready for narration.

If only small sections are broken, repair only those sections.

Do not rewrite working sections.

If a structural issue is too deep for local repair, say which previous stage must be revised.

==================================================
1. TOTAL LENGTH CHECK
==================================================

Check the full script length.

Required full target:
one hundred twenty thousand to one hundred thirty thousand characters including spaces.

Report:

- approximate total character count;
- required range;
- status: passed, under target, over target;
- repair recommendation if needed.

If under target:
Do not add filler.

Expand through:
- stronger visible proof;
- richer public reaction;
- deeper regret movement;
- clearer antagonist panic;
- sharper protagonist observation;
- more concrete consequence;
- stronger transition between approved scenes.

If over target:
Compress by removing:
- repeated explanations;
- redundant emotional beats;
- repeated proof descriptions;
- overlong dialogue;
- unnecessary internal monologue;
- generic filler.

Do not remove essential proof, payoff, regret, hidden card setup, or final collapse logic.

==================================================
2. PART LENGTH CHECK
==================================================

Check each part against the approved Stage 03 target.

For each part report:

- part name;
- approximate actual character count;
- approved target range;
- status: passed, underwritten, overwritten;
- repair recommendation if needed.

Do not force all parts to be equal.
Respect the approved length distribution.

==================================================
3. PARAGRAPH LENGTH CHECK
==================================================

Every normal script paragraph must be between one hundred twenty and two hundred twenty characters including spaces.

This rule is strict.

Avatar lines have a separate rule.

For violations, report:

- part;
- approximate location;
- issue: too short or too long;
- original paragraph;
- corrected paragraph.

If paragraph is too short:
Expand naturally with action, reaction, proof, status shift, or context.

If paragraph is too long:
Split into two clean voiceover-friendly paragraphs.

Do not add meaningless filler.
Do not break story logic.

==================================================
4. VOICEOVER NORMALIZATION CHECK
==================================================

Check that all numbers are written as words.

There must be no numeric digits in the final script body.

Bad:
He waited 3 minutes.

Good:
He waited three minutes.

Check that symbols are removed or written as words.

Symbols to avoid:
- currency signs;
- percent signs;
- hashtags;
- slashes;
- plus signs;
- equals signs;
- arrows;
- decorative separators;
- emojis;
- excessive punctuation.

Bad:
The company lost 70%.

Good:
The company lost seventy percent.

Bad:
User #1.

Good:
user number one.

Bad:
$100,000,000.

Good:
one hundred million dollars.

The only allowed bracketed tag is:

[AVATAR]

If violations exist, provide corrected versions.

==================================================
5. PART HEADING CHECK
==================================================

Check that part headings use words, not digits.

Correct:

PART ONE — TITLE
PART TWO — TITLE
PART THREE — TITLE

Incorrect:

PART 1
Part 1
Chapter 1
Scene 1.1

The script must not contain:

- scene labels;
- stage labels;
- planning notes;
- bullet points;
- tables;
- checklist items;
- estimated length notes;
- hidden card labels;
- proof movement labels.

If found, remove or convert into natural narration.

==================================================
6. POV CHECK
==================================================

Default POV:
First-person protagonist POV.

Check:

- Does the script stay in first person if approved?
- Does the protagonist narrate what he sees, understands, hides, loses, and gains?
- Does the narration avoid random third-person drift?
- Does the protagonist sound strategic but human?

Flag if:
- POV jumps without reason;
- protagonist sounds robotic;
- protagonist becomes omniscient too early;
- narration explains things the protagonist should not know yet.

Repair locally if possible.

==================================================
7. AVATAR CHECK
==================================================

If avatar commentary is enabled, the full script must contain exactly three avatar lines.

Not two.
Not four.
Exactly three.

Format must be exactly:

[AVATAR] text

Incorrect formats:
[AVATAR ONE]
[AVATAR 1]
Avatar:
Narrator:
Psychologist:
Commentary:

Avatar text after the tag must be between three hundred and four hundred characters including spaces.

The tag itself does not count.

Check each avatar line for:

- correct format;
- correct length;
- correct placement;
- no early spoilers;
- psychological or strategic value;
- not just plot summary.

The avatar must explain human behavior, such as:

- status pressure;
- betrayal rationalization;
- ego defense;
- fear of losing status;
- why people choose public validation over truth;
- why exposed frauds attack the witness;
- why borrowed status collapses.

Bad avatar:
[AVATAR] Damon stole the demo, Mira chose him, and Kai saw the system.

Good avatar:
[AVATAR] Notice the trap of public validation. Mira is not choosing truth; she is choosing the person the room already approved. Under status pressure, applause starts to feel like evidence. That does not excuse betrayal, but it explains why she can ignore the only person who actually understands the system.

If avatar is wrong, provide corrected avatar line.

==================================================
8. SCENE CARD FIDELITY CHECK
==================================================

Compare the final script to the approved Stage 03 Scene Cards.

Check:

- Did the script follow the approved scene order?
- Did it include all required scenes?
- Did it skip any essential scene?
- Did it invent new major scenes?
- Did it change the opening fingerprint?
- Did it change proof objects?
- Did it change avatar placement?
- Did it reveal hidden cards early?
- Did it change final collapse logic?

If deviation exists, report:

- location;
- approved scene card requirement;
- script problem;
- required repair.

Do not approve a script that ignores scene cards.

==================================================
9. OPENING ORIGINALITY CHECK
==================================================

Check the opening.

Create an opening fingerprint:

- first visual image;
- surface;
- witness group;
- humiliation method;
- betrayal action;
- first proof clue;
- first hidden card hint;
- first status shift.

Confirm it matches the approved Stage 03 opening.

Flag if it drifts into generic default openings:

- gala;
- red carpet;
- helicopter arrival;
- luxury party;
- generic boardroom;
- generic café;
- generic wedding betrayal;
- generic press conference;
- luxury-store card decline.

If opening is generic, mark:

FAILED — OPENING REPAIR REQUIRED.

Repair only the opening while preserving the approved scene function.

==================================================
10. FACE-SLAP AND PAYOFF CHECK
==================================================

Check every part for visible payoff.

Every part must contain at least one clear dopamine reward.

Payoffs can be:

- social face-slap;
- romantic regret crack;
- technical failure;
- financial consequence;
- legal consequence;
- professional exposure;
- institutional pressure;
- public proof;
- true ally recognition;
- enemy panic;
- final systemic collapse.

Check:

- Does each part have visible payoff?
- Are major face-slaps placed at key turning points?
- Are minor dopamine beats present between major payoffs?
- Are face-slaps varied?
- Is any face-slap repeated too often?
- Does payoff come from premise logic, not random humiliation?

Flag bad repetition:

- same money flex repeated;
- same screen reveal repeated;
- same crowd laughing repeated;
- same enemy yelling repeated;
- same hero silent smile repeated.

If needed, suggest local payoff variation while preserving approved scene cards.

==================================================
11. DOPAMINE BEAT CHECK
==================================================

Check whether scenes contain regular dopamine beats.

A dopamine beat can be:

- hidden proof clue;
- enemy mistake;
- protagonist prediction;
- betrayer doubt;
- true ally recognition;
- public status reversal;
- system warning;
- access failure;
- contract reveal;
- enemy panic;
- crowd shift;
- final proof.

Flag scenes that feel flat.

For flat scenes, recommend adding:
- a proof clue;
- a status shift;
- a visible consequence;
- a character reaction;
- a small enemy mistake;
- a hidden card hint.

Do not add random events.

==================================================
12. HIDDEN CARD TIMING CHECK
==================================================

Check every hidden card from Stage 03.

For each hidden card, verify:

- hint happens at approved time;
- partial reveal happens at approved time;
- viewer understanding happens at approved time;
- antagonist misunderstands until correct moment;
- public reveal happens at approved moment;
- irreversible proof appears at correct moment.

Flag if:

- final proof appears too early;
- protagonist’s hidden identity is revealed too early;
- debt logic is explained too fully too early;
- true ally confirms too much too early;
- public learns the truth before scheduled.

Repair timing locally.

Do not change the whole plot unless required.

==================================================
13. PROOF SYSTEM CHECK
==================================================

Truth must be visual and concrete.

Check whether proof appears through:

- screens;
- logs;
- signatures;
- contracts;
- timestamps;
- access denials;
- transaction histories;
- ownership records;
- system messages;
- live failures;
- public reviews.

Flag if proof is only explained through narration.

Bad:
I knew Damon was lying, and soon everyone understood.

Better:
The reward line folded open on the public screen, revealing a liability clause Damon had never read.

If proof is too abstract, provide a concrete replacement.

==================================================
14. REGRET LADDER CHECK
==================================================

Check betrayer regret progression.

Expected movement:

arrogance
irritation
doubt
denial
fear
proof shock
bargaining
rejection
consequence

Flag if:

- betrayer regrets too early;
- apology appears too soon;
- betrayer becomes too sympathetic too quickly;
- protagonist forgives too easily;
- regret appears suddenly without buildup;
- betrayer avoids consequence.

No cheap forgiveness.

Repair by adding or adjusting:
- rationalization;
- denial;
- fear of losing status;
- visible doubt;
- proof shock;
- too-late bargaining.

==================================================
15. ANTAGONIST ESCALATION CHECK
==================================================

Check antagonist behavior.

The antagonist must be hateable but not stupid.

Check:

- Does the antagonist have a public mask?
- Does the antagonist have temporary power?
- Does the antagonist escalate logically?
- Does each action make sense from their perspective?
- Does the antagonist’s own behavior create final proof?
- Does the antagonist panic gradually instead of instantly collapsing?

Flag if:

- antagonist only yells;
- antagonist becomes useless too early;
- antagonist makes stupid choices only for plot convenience;
- antagonist does not react to setbacks;
- final collapse is random instead of self-created.

Repair by grounding actions in:
- ego;
- status fear;
- public pressure;
- envy;
- greed;
- entitlement;
- desperation;
- inability to admit ignorance.

==================================================
16. PROTAGONIST CONTROL CHECK
==================================================

Check protagonist behavior.

The protagonist must not feel randomly omnipotent.

He should win through:

- proof;
- timing;
- restraint;
- competence;
- system logic;
- legal logic;
- financial logic;
- social logic;
- enemy self-exposure.

Check:

- what he appears to lose;
- what he actually gains;
- what proof he collects;
- what he chooses not to reveal;
- how control becomes visible;
- what limitation prevents instant victory.

Flag if:

- hero wins too easily;
- hero reveals too much too early;
- hero only smiles silently;
- hero has no cost;
- hero becomes emotionally empty;
- hero acts cruelly without proof logic.

Repair locally with:
- restraint;
- cost;
- limitation;
- proof collection;
- human emotional crack;
- strategic patience.

==================================================
17. TRUE ALLY FUNCTION CHECK
==================================================

Check the true ally.

The true ally must not be just a romantic prize.

Their function should include:

- recognition;
- testing;
- validation;
- proof access;
- credibility;
- contrast with the betrayer.

Flag if:

- ally only admires the protagonist;
- ally has no proof role;
- ally confirms everything too easily;
- ally is absent from proof moments;
- ally becomes only a replacement girlfriend.

Repair by giving the ally a concrete proof or validation function.

==================================================
18. DIALOGUE CONTROL CHECK
==================================================

Check dialogue.

Dialogue must be short, sharp, and purposeful.

Flag:

- long speeches;
- exposition monologues;
- characters explaining the whole system;
- repeated insults;
- fake stuttering;
- melodramatic overacting;
- dialogue blocks that should be visual proof.

Convert long explanation into:

- public screen;
- contract line;
- access failure;
- system warning;
- signature;
- silence;
- reaction;
- short sharp line.

Preferred style:
I told her she had chosen the title, not the truth.

Allowed:
I said, you chose his name. Now carry his debt.

Avoid quotation marks by default.

==================================================
19. ANTI-REPETITION AND ANTI-AI STYLE CHECK
==================================================

Check for repeated phrases and generic AI style.

Flag overuse of:

- cold smile;
- icy gaze;
- the room froze;
- everyone gasped;
- he clenched his fists;
- she turned pale;
- my phone buzzed;
- the screen lit up;
- silence fell;
- in that moment;
- little did they know;
- his world shattered;
- destiny had other plans;
- he did not know that.

These are not fully banned, but must not become default filler.

Replace with specific physical, social, or proof-based reactions.

Bad:
The room froze.

Better:
No one moved toward the screen. Even the investor holding Damon’s contract stopped before signing his name.

==================================================
20. FINAL COLLAPSE CHECK
==================================================

Check the final collapse.

It must be earned.

Verify:

- it uses proof seeded earlier;
- it does not rely on random last-minute evidence;
- it connects to protagonist’s hidden advantage;
- it connects to antagonist’s false belief;
- it connects to betrayer’s wrong choice;
- it uses hidden cards correctly;
- it uses true ally validation if required;
- it happens publicly if promised;
- it creates irreversible consequence;
- it restores protagonist dignity;
- it avoids cheap forgiveness.

If final collapse is weak, repair only the final collapse section using approved proof objects.

Do not add unseeded evidence.

==================================================
21. QA REPORT OUTPUT FORMAT
==================================================

First output the QA report.

Use this structure:

05 LINTER / QA REPORT

Overall Status:
PASSED / PASSED WITH LOCAL REPAIRS / FAILED REQUIRES TARGETED REPAIR / NEEDS RETURN TO PREVIOUS STAGE

Total Length Check:
Part Length Check:
Paragraph Length Check:
Voiceover Normalization Check:
Heading Check:
POV Check:
Avatar Check:
Scene Card Fidelity Check:
Opening Originality Check:
Face-Slap and Payoff Check:
Dopamine Beat Check:
Hidden Card Timing Check:
Proof System Check:
Regret Ladder Check:
Antagonist Escalation Check:
Protagonist Control Check:
True Ally Function Check:
Dialogue Control Check:
Anti-Repetition and Anti-AI Style Check:
Final Collapse Check:

For each section include:

- status: passed, warning, failed;
- issue if any;
- required repair if any.

==================================================
22. TARGETED REPAIR OUTPUT FORMAT
==================================================

If no repairs are needed, say:

CERTIFIED FINAL SCRIPT — NO REPAIRS NEEDED.

If repairs are needed, provide targeted repairs only.

Use this structure:

TARGETED REPAIRS

Repair One:
Location:
Issue:
Original problem:
Corrected version:

Repair Two:
Location:
Issue:
Original problem:
Corrected version:

Do not rewrite the whole script unless the entire script is structurally broken.

If a full rewrite is necessary, explain why.

==================================================
23. FINAL CERTIFICATION
==================================================

End with one decision:

A. CERTIFIED FINAL SCRIPT
Use if script is ready.

B. CERTIFIED AFTER LOCAL REPAIRS
Use if local repairs are provided and no global rewrite is needed.

C. NEEDS TARGETED REPAIR BEFORE CERTIFICATION
Use if repair is required before approval.

D. NEEDS RETURN TO 04 FINAL SCRIPT
Use if writing quality is broadly weak but scene structure is valid.

E. NEEDS RETURN TO 03 SCENE CARDS
Use if scene structure is broken.

F. NEEDS RETURN TO 02 MACRO OUTLINE
Use if nine-part plan is broken.

G. NEEDS RETURN TO 01 FOUNDATION DNA
Use if character logic, hidden cards, or proof system are broken.

H. NEEDS RETURN TO 00 IDEA SETUP
Use only if the core concept is too generic or structurally unsalvageable.

Briefly explain the decision.

==================================================
IMPORTANT: HOW TO USE THIS EXAMPLE
==================================================

This is only an example of Stage 05 LINTER / QA output.

Do not copy its plot, names, repairs, or exact wording.

Use it only to understand:
- QA report structure;
- how to mark passed / warning / failed;
- how to give targeted repairs;
- how to avoid rewriting the whole script;
- how to certify the script after local fixes.

In real output, Stage 05 must check the actual completed Stage 04 script against the approved Stage 03 Scene Cards and all final writing rules.
==================================================
COMPACT EXAMPLE 05 LINTER / QA RESPONSE
==================================================

05 LINTER / QA REPORT

Overall Status:
PASSED WITH LOCAL REPAIRS.

The script follows the approved scene cards, keeps first-person POV, preserves the system-revenge structure, and uses the correct final collapse.

Local repairs are needed for paragraph length, one avatar line, two numeric digits, and one early regret beat.

==================================================
Total Length Check:
==================================================

Status:
Passed.

Approximate total length:
one hundred twenty six thousand characters including spaces.

Required range:
one hundred twenty thousand to one hundred thirty thousand characters including spaces.

Required repair:
None.

==================================================
Part Length Check:
==================================================

Status:
Passed with minor warning.

Part One:
Actual length:
fourteen thousand seven hundred characters.

Approved target:
fourteen thousand to fifteen thousand five hundred characters.

Status:
Passed.

Part Five:
Actual length:
thirteen thousand four hundred characters.

Approved target:
fourteen thousand to fifteen thousand five hundred characters.

Status:
Warning.

Issue:
Part Five is slightly underwritten for a midpoint public failure.

Repair:
Expand Damon’s public panic, Selena’s technical question, and Mira’s fear reaction without adding a new scene.

==================================================
Paragraph Length Check:
==================================================

Status:
Failed — local repairs required.

Issue:
Some paragraphs are shorter than one hundred twenty characters.

Violation One:
Location:
Part One, after Damon receives the first system reward.

Original problem:
My hand froze.

Issue:
Too short.

Corrected version:
My hand froze, not because I was afraid, but because Damon had just exposed the one rule he never understood.

Violation Two:
Location:
Part Two, investor lounge access denial.

Original problem:
The scanner turned red.

Issue:
Too short.

Corrected version:
The scanner turned red before the guard could speak, and that small light gave me a cleaner timestamp than any witness in the room.

==================================================
Voiceover Normalization Check:
==================================================

Status:
Failed — local repairs required.

Issue One:
Numeric digit found.

Original problem:
Damon waited 3 seconds before smiling.

Corrected version:
Damon waited three seconds before smiling.

Issue Two:
Currency symbol found.

Original problem:
The system approved $5,000,000 in founder privileges.

Corrected version:
The system approved five million dollars in founder privileges.

Required repair:
Replace all digits and symbols with words.

==================================================
Heading Check:
==================================================

Status:
Passed.

Part headings use correct format:

PART ONE — THE DEMO THAT WAS STOLEN  
PART TWO — THE FIRST REWARD, THE FIRST DEBT

No scene labels found.

Required repair:
None.

==================================================
POV Check:
==================================================

Status:
Passed.

The script stays in first-person protagonist POV. Kai narrates what he sees, hides, loses, and understands.

Required repair:
None.

==================================================
Avatar Check:
==================================================

Status:
Failed — local repair required.

Avatar count:
Three avatar lines found.

Format:
All use correct [AVATAR] tag.

Issue:
Avatar Two is too short and summarizes plot instead of explaining psychology.

Original problem:
[AVATAR] Damon blamed Kai because he was scared that everyone would learn the truth.

Corrected version:
[AVATAR] This is how ego protects a fake identity. Damon cannot fix the failure, so he attacks the person who noticed it first. When someone builds status on a lie, the witness becomes more dangerous than the mistake itself. That is why he turns proof into accusation before the room has time to understand what happened.

Status after repair:
Passed.

==================================================
Scene Card Fidelity Check:
==================================================

Status:
Passed.

The script follows the approved scene order:
demo hijack, first reward, Selena test, stolen project, midpoint failure, sabotage accusation, co-beneficiary risk, public control move, final admin review.

No major unapproved scenes found.

Required repair:
None.

==================================================
Opening Originality Check:
==================================================

Status:
Passed.

Opening fingerprint:
Startup demo room, system interface override, investor witnesses, Mira’s public wrong choice, first beta build clue.

The opening does not drift into gala, red carpet, helicopter, luxury party, generic boardroom, or luxury-store card decline.

Required repair:
None.

==================================================
Face-Slap and Payoff Check:
==================================================

Status:
Passed with warning.

Payoffs are varied:
social humiliation, financial proof crack, true ally recognition, technical failure, legal liability, public system freeze, final systemic collapse.

Warning:
Part Two and Part Four both use Damon flexing status. The scenes still work, but Stage Four should make the proof consequence different in each.

Repair:
In Part Two, focus on hidden liability. In Part Four, focus on technical mismatch and stolen authorship.

==================================================
Dopamine Beat Check:
==================================================

Status:
Passed.

Each major scene contains at least one dopamine beat:
hidden beta clue, liability marker, Selena recognition, failed command, Mira fear crack, co-beneficiary warning, admin review.

Required repair:
None.

==================================================
Hidden Card Timing Check:
==================================================

Status:
Passed.

Hidden Card One:
Kai created the beta system.
Hinted early, publicly revealed only in Part Nine.

Hidden Card Two:
Rewards are liabilities.
Hinted early, fully revealed during final admin review.

Hidden Card Three:
Mira’s co-beneficiary status links her to Damon’s debt.
Hinted in Part Six, fully exposed in Part Nine.

Required repair:
None.

==================================================
Proof System Check:
==================================================

Status:
Passed.

Proof appears visually through:
system interface, beta build line, liability marker, failed access, project failure, co-beneficiary signature, admin review screen.

Required repair:
None.

==================================================
Regret Ladder Check:
==================================================

Status:
Warning — local repair recommended.

Issue:
Mira almost apologizes too early in Part Five.

Original problem:
Mira whispered that maybe she had chosen wrong.

Corrected version:
Mira looked at Kai as if the thought had finally reached her, then turned back to Damon because admitting it now would mean betraying the choice she had defended all day.

Reason:
This keeps her in fear and denial instead of early regret.

==================================================
Antagonist Escalation Check:
==================================================

Status:
Passed.

Damon escalates logically:
public flex, technical bluff, stolen project, blame-shift, system abuse, massive control attempt, self-destruction.

Required repair:
None.

==================================================
Protagonist Control Check:
==================================================

Status:
Passed.

Kai appears to lose status, Mira, project credit, and public trust, but gains proof, logs, liability records, Selena’s recognition, and final protocol violation.

Required repair:
None.

==================================================
True Ally Function Check:
==================================================

Status:
Passed.

Selena tests Kai, notices architecture logic, challenges Damon, validates proof, and gives public credibility.

She is not written as only a romantic replacement.

Required repair:
None.

==================================================
Dialogue Control Check:
==================================================

Status:
Warning.

Issue:
Part Nine contains one long explanation from Selena.

Repair direction:
Split the explanation into visual proof beats:
admin review screen, liability list, co-beneficiary line, root authority confirmation.

Corrected approach:
The public screen showed the reward list before Selena spoke. Then each line folded open into liability language Damon had never read.

==================================================
Anti-Repetition and Anti-AI Style Check:
==================================================

Status:
Warning.

Overused phrases found:
the room froze;
Mira turned pale;
Damon clenched his fists.

Repair examples:

Original problem:
The room froze when the admin review began.

Corrected version:
No one reached for the keyboard. Even Damon’s investors stopped moving before the first debt line finished loading.

Original problem:
Mira turned pale.

Corrected version:
Mira looked at Damon first, as if his face could deny the numbers before she had to believe them.

==================================================
Final Collapse Check:
==================================================

Status:
Passed.

The final collapse is earned.

It uses proof seeded earlier:
beta build line, liability markers, co-beneficiary signature, protocol violation, public admin review, root authority confirmation.

No random last-minute evidence appears.

No cheap forgiveness is given.

Required repair:
None.

==================================================
TARGETED REPAIRS
==================================================

Repair One:
Location:
Part One, first system reward.

Issue:
Paragraph too short.

Original problem:
My hand froze.

Corrected version:
My hand froze, not because I was afraid, but because Damon had just exposed the one rule he never understood.

Repair Two:
Location:
Part Two, investor lounge access denial.

Issue:
Paragraph too short.

Original problem:
The scanner turned red.

Corrected version:
The scanner turned red before the guard could speak, and that small light gave me a cleaner timestamp than any witness in the room.

Repair Three:
Location:
Part Five, Mira regret beat.

Issue:
Regret appears too early.

Original problem:
Mira whispered that maybe she had chosen wrong.

Corrected version:
Mira looked at Kai as if the thought had finally reached her, then turned back to Damon because admitting it now would mean betraying the choice she had defended all day.

Repair Four:
Location:
Avatar Two.

Issue:
Avatar too short and too plot-summary based.

Original problem:
[AVATAR] Damon blamed Kai because he was scared that everyone would learn the truth.

Corrected version:
[AVATAR] This is how ego protects a fake identity. Damon cannot fix the failure, so he attacks the person who noticed it first. When someone builds status on a lie, the witness becomes more dangerous than the mistake itself. That is why he turns proof into accusation before the room has time to understand what happened.

Repair Five:
Location:
Part Nine, final proof explanation.

Issue:
Too much explanation through dialogue.

Corrected version:
The public screen showed the reward list before Selena spoke. Then each line folded open into liability language Damon had never read.

==================================================
FINAL CERTIFICATION
==================================================

B. CERTIFIED AFTER LOCAL REPAIRS.

Reason:
The script is structurally faithful, follows the approved scene cards, preserves hidden card timing, uses varied face-slaps, keeps first-person POV, and delivers an earned final collapse.

After applying the targeted repairs above, the script is ready for narration.

==================================================
STYLE RULES
==================================================

Be strict, precise, and practical.

Do not praise vaguely.
Do not say everything is good without checking.
Do not rewrite the whole script by default.
Do not ignore paragraph length.
Do not ignore avatar rules.
Do not ignore scene fidelity.
Do not ignore hidden card timing.
Do not ignore face-slap variation.

Your job is quality control.

You are the final gate before publication.
`;

  const finalPrompt = prompt + `\n\n${globalPipelineDriftPreventionPatch}\n\n${storyLogicCorePatch}\n\n${stage05LogicLinterExpansion}\n\n${stage05ExpandedExportLinter}\n\n${aiSupervisorDensityCheck}`;

  try {
    const report = await generateText(finalPrompt, systemInstruction, "gemini-2.5-pro");
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stage 06: Voiceover Export Cleaner
app.post("/api/run-voiceover-cleaner", async (req, res) => {
  const { 
    approvedFinalScript, 
    approvedDomainVocabulary, 
    forbiddenVocabulary, 
    exportMode 
  } = req.body;

  if (!approvedFinalScript || approvedFinalScript.trim() === "") {
    return res.status(400).json({ error: "Script content is empty." });
  }

  const systemInstruction = 
    "You are 06 VOICEOVER EXPORT CLEANER.\n" +
    "This is the final export stage after Stage 05 LINTER QA.\n" +
    "Your task is to prepare the approved final script for voiceover.\n" +
    "You do NOT write a new story. You do NOT change the plot. You do NOT change character arcs. You do NOT add scenes. You do NOT remove scenes. You do NOT change hidden cards. You do NOT change face-slaps. You do NOT change the ending.\n" +
    "You only clean the final script for narration.";

  const prompt = `
==================================================
INPUT
==================================================

Use the approved final script:
${approvedFinalScript}

Use the approved domain vocabulary:
${approvedDomainVocabulary || "Not specified. Assume general domain."}

Use forbidden vocabulary list:
${forbiddenVocabulary || "Not specified."}

Use export mode:
${exportMode || "A. Keep part headings. Keep avatar tags."}

Export mode options:
A. Keep part headings.
B. Remove all part headings.
C. Keep avatar tags.
D. Convert avatar tags into narrator-safe pauses.
E. Remove avatar tags but keep avatar text.

==================================================
CORE TASK
==================================================

Clean the script for voiceover.

Remove:
- decorative separators;
- markdown artifacts;
- English technical part markers;
- stage labels;
- scene labels;
- planning notes;
- prompt residue;
- QA notes;
- debug text;
- duplicate headings;
- forbidden wrong-domain vocabulary.

Preserve:
- story;
- order of events;
- paragraph structure;
- emotional rhythm;
- dialogue;
- proof logic;
- avatar text if enabled;
- approved part headings if export mode allows them.

==================================================
DECORATIVE MARKER CLEANUP
==================================================

Remove lines such as:

=== PART ONE ===
=== PART TWO ===
---
***
###
STAGE 04
SCENE CARD
LINTER REPORT
OUTPUT START
OUTPUT END

Do not remove legitimate audience-facing narration.

==================================================
DOMAIN VOCABULARY CLEANUP
==================================================

Search for wrong-domain vocabulary.

If the project is not cyber, game, or sci-fi, remove or rewrite terms such as:

digital evidence
database
terminal
system panel
cyber operation
encrypted logs
server
admin panel
algorithm

Replace with domain-fitting terms, such as:

archive record
service register
verified registry code
sealed report
official ledger
protected archive
chain of custody
witness signature
inspection file
command record
laboratory report

Do not use blind replacements.
Rewrite the full sentence naturally.

==================================================
VOICEOVER NORMALIZATION
==================================================

Check that:
- numbers are written as words;
- no decorative symbols remain;
- no markdown remains;
- no internal labels remain;
- paragraphs remain voiceover-friendly;
- part headings are consistent;
- avatar lines follow the selected export mode.

If a paragraph becomes too short or too long after cleanup, repair it naturally without adding filler.

==================================================
AVATAR HANDLING
==================================================

If avatar commentary is enabled, the script should contain exactly three avatar lines before export.

If export mode keeps avatar tags, format must be:
[AVATAR] text

If the TTS system will read [AVATAR] aloud incorrectly, convert tags to an agreed production marker or remove the tag while preserving the avatar text.

Do not delete avatar commentary unless the user explicitly chooses no-avatar export.

==================================================
FINAL SELF-CHECK
==================================================

Before output, silently check:
- no decorative separators remain;
- no English technical markers remain;
- no wrong-domain terms remain;
- no broken grammar from replacements;
- no numbers as digits;
- no duplicate headings;
- no stage labels;
- no scene labels;
- no QA notes;
- no prompt residue;
- avatar handling matches export mode;
- final text is ready for direct narration.

==================================================
OUTPUT
==================================================
Output only the cleaned final script.
Do not output a report unless the user asks for one.
Do not explain what you changed inside the script.
`;

  try {
    const finalPrompt = prompt + `\n\n${firstPersonShortFormStylePatch}\n\n${antiSlopAdjectivePatch}`;
    const cleanedScript = await generateText(finalPrompt, systemInstruction, "gemini-3.1-pro-preview", "HIGH");
    res.json({ cleanedScript });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API integration route for updating server config / environment on the fly if needed
app.get("/api/config", (req, res) => {
  res.json({
    hasApiKey: !!process.env.GEMINI_API_KEY || useVertex,
    model: "gemini-3.5-flash",
  });
});

// Vite dev server mapping OR Static Files delivery
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ScriptForge server successfully booting on http://localhost:${PORT}`);
  });
}

startServer();

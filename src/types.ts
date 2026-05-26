export type StageStatus = 'not_started' | 'draft' | 'approved' | 'needs_repair';

export interface StageData {
  output: string;
  handoff: string;
  status: StageStatus;
  feedback?: string;
}

export interface ScriptPart {
  number: number;
  title: string;
  status: StageStatus;
  output: string;
  feedback?: string;
  memory?: string;
}

export interface ProjectState {
  rawIdea: string;
  competitorBlueprint: string; // Optional Reference analysis mode blueprint
  activeStageIdx: number;
  stages: {
    '00_idea': StageData;
    '01_foundation': StageData;
    '02_macro': StageData;
    '03_scenes': StageData;
    '04_script': StageData;
    '05_linter': StageData;
    '06_cleaner': StageData;
  };
  scriptParts: ScriptPart[]; // Stage 04 breakdown (Part 1 - Part 9)
  avatarCommentaryEnabled: boolean;
  notes: string;
  warnings: string[];
}

export interface LockedMemory {
  storyDna: string;
  characters: string;
  hiddenCards: string;
  proofSystem: string;
}

export const STAGES_CONFIG = [
  { id: 0, key: '00_idea' as const, code: '00', name: 'IDEA SETUP', description: 'Compact producer brief & core hook' },
  { id: 1, key: '01_foundation' as const, code: '01', name: 'FOUNDATION DNA', description: 'Character logic & escalation' },
  { id: 2, key: '02_macro' as const, code: '02', name: 'MACRO OUTLINE', description: 'Nine-part outline & pacing' },
  { id: 3, key: '03_scenes' as const, code: '03', name: 'SCENE CARDS', description: 'Scene matrix & exit hooks' },
  { id: 4, key: '04_script' as const, code: '04', name: 'FINAL SCRIPT', description: 'Drafting 9 parts with rule locks' },
  { id: 5, key: '05_linter' as const, code: '05', name: 'LINTER QA', description: 'Technical check & surgical repair' },
  { id: 6, key: '06_cleaner' as const, code: '06', name: 'VOICEOVER CLEANER', description: 'Final narration cleanup' },
];

export const INITIAL_SCRIPT_PARTS: ScriptPart[] = [
  { number: 1, title: 'PART ONE', status: 'not_started', output: '' },
  { number: 2, title: 'PART TWO', status: 'not_started', output: '' },
  { number: 3, title: 'PART THREE', status: 'not_started', output: '' },
  { number: 4, title: 'PART FOUR', status: 'not_started', output: '' },
  { number: 5, title: 'PART FIVE', status: 'not_started', output: '' },
  { number: 6, title: 'PART SIX', status: 'not_started', output: '' },
  { number: 7, title: 'PART SEVEN', status: 'not_started', output: '' },
  { number: 8, title: 'PART EIGHT', status: 'not_started', output: '' },
  { number: 9, title: 'PART NINE', status: 'not_started', output: '' },
];

export const INITIAL_PROJECT_STATE: ProjectState = {
  rawIdea: '',
  competitorBlueprint: '',
  activeStageIdx: 0,
  stages: {
    '00_idea': { output: '', handoff: '', status: 'not_started' },
    '01_foundation': { output: '', handoff: '', status: 'not_started' },
    '02_macro': { output: '', handoff: '', status: 'not_started' },
    '03_scenes': { output: '', handoff: '', status: 'not_started' },
    '04_script': { output: '', handoff: '', status: 'not_started' },
    '05_linter': { output: '', handoff: '', status: 'not_started' },
    '06_cleaner': { output: '', handoff: '', status: 'not_started' },
  },
  scriptParts: INITIAL_SCRIPT_PARTS,
  avatarCommentaryEnabled: true,
  notes: 'Provide a robust raw idea layout or paste competitor blueprints above to analyze pacing.',
  warnings: []
};

import { Lock, ToggleLeft, ToggleRight, Sparkles, Check, AlertCircle, HelpCircle } from "lucide-react";
import { ProjectState, STAGES_CONFIG } from "../types";

interface RightPanelProps {
  state: ProjectState;
  setAvatarCommentaryEnabled: (enabled: boolean) => void;
  onClearProject: () => void;
}

export default function RightPanel({ state, setAvatarCommentaryEnabled, onClearProject }: RightPanelProps) {
  // Count how many [AVATAR] tags are currently drafted in the script parts
  const draftedParts = state.scriptParts.filter(p => p.output && p.output.trim() !== "");
  const avatarMatches: { part: string; length: number; isValid: boolean; text: string }[] = [];

  state.scriptParts.forEach(part => {
    if (part.output) {
      const regex = /\[AVATAR\]\s*([\s\S]*?)(?=\[AVATAR\]|\n\n|\nPART|$)/gi;
      let match;
      while ((match = regex.exec(part.output)) !== null) {
        const text = match[1].trim();
        const length = text.length;
        const isValid = length >= 300 && length <= 400;
        avatarMatches.push({
          part: part.title,
          length,
          isValid,
          text: text.slice(0, 80) + (text.length > 80 ? '...' : '')
        });
      }
    }
  });

  // Extract brief locks based on approved handoff summaries
  const is00Approved = state.stages["00_idea"].status === "approved";
  const is01Approved = state.stages["01_foundation"].status === "approved";
  const is02Approved = state.stages["02_macro"].status === "approved";
  const is03Approved = state.stages["03_scenes"].status === "approved";

  // Helper to parse key values out of handoffs for display
  const getHandoffValue = (handoffText: string, searchKey: string): string => {
    if (!handoffText) return "";
    const lines = handoffText.split("\n");
    const foundLine = lines.find(l => l.toLowerCase().includes(searchKey.toLowerCase()));
    if (foundLine) {
      const idx = foundLine.indexOf(":");
      return idx !== -1 ? foundLine.slice(idx + 1).trim() : foundLine;
    }
    return "";
  };

  const storyDna = getHandoffValue(state.stages["00_idea"].handoff, "story dna");
  const tropeInfo = getHandoffValue(state.stages["00_idea"].handoff, "main trope");
  const characterSummary = getHandoffValue(state.stages["01_foundation"].handoff, "character");
  const proofLock = getHandoffValue(state.stages["01_foundation"].handoff, "proof system");
  const escalationMap = getHandoffValue(state.stages["01_foundation"].handoff, "escalation");

  return (
    <aside className="w-80 border-l border-white/10 bg-[#0F1115] p-5 flex flex-col gap-6 overflow-y-auto" id="scriptforge-right-sidebar">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-blue-400" />
          Locked Project Memory
        </h3>
        <div className="flex flex-col gap-2.5">
          {/* Stage 00 Locks */}
          <div className={`p-3 rounded border text-xs transition-colors ${is00Approved ? "bg-white/5 border-white/5 border-l-2 border-l-emerald-500" : "bg-white/2 border-white/5 opacity-60"}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-white text-[11px]">00 STORY BRIEF</span>
              {is00Approved ? (
                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> LOCKED
                </span>
              ) : (
                <span className="text-[9px] font-mono text-slate-500">UNLOCKED</span>
              )}
            </div>
            {is00Approved ? (
              <div className="text-slate-400 space-y-1 mt-1.5 font-mono text-[10px]">
                <p><span className="text-slate-500">DNA:</span> {storyDna || "Approved Idea brief locked"}</p>
                <p><span className="text-slate-500">Trope:</span> {tropeInfo || "Standard drama tropes locked"}</p>
              </div>
            ) : (
              <p className="text-slate-500 italic text-[10px] mt-1">Approve Stage 00 to lock narrative brief.</p>
            )}
          </div>

          {/* Stage 01 Locks */}
          <div className={`p-3 rounded border text-xs transition-colors ${is01Approved ? "bg-white/5 border-white/5 border-l-2 border-l-emerald-500" : "bg-white/2 border-white/5 opacity-60"}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-white text-[11px]">01 FOUNDATION KEYFACTS</span>
              {is01Approved ? (
                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> LOCKED
                </span>
              ) : (
                <span className="text-[9px] font-mono text-slate-500">UNLOCKED</span>
              )}
            </div>
            {is01Approved ? (
              <div className="text-slate-400 space-y-1 mt-1.5 font-mono text-[10px]">
                <p><span className="text-slate-500">Cast:</span> {characterSummary || "Logical character constraints locked"}</p>
                <p><span className="text-slate-500">Proof:</span> {proofLock || "Locked facts proof rules set"}</p>
                <p><span className="text-slate-500">Escalation:</span> {escalationMap || "Ladder progression initialized"}</p>
              </div>
            ) : (
              <p className="text-slate-500 italic text-[10px] mt-1">Approve Stage 01 to lock structural constraints.</p>
            )}
          </div>

          {/* Stage 02 Locks */}
          <div className={`p-3 rounded border text-xs transition-colors ${is02Approved ? "bg-white/5 border-white/5 border-l-2 border-l-blue-400" : "bg-white/2 border-white/5 opacity-60"}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-white text-[11px]">02 MACRO OUTLINE MAP</span>
              {is02Approved ? (
                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> LOCKED
                </span>
              ) : (
                <span className="text-[9px] font-mono text-slate-500">UNLOCKED</span>
              )}
            </div>
            {is02Approved ? (
              <p className="text-slate-400 font-mono text-[10px] mt-1">
                Approved 9-part story spine is locked. Subscenery and tension anchors frozen.
              </p>
            ) : (
              <p className="text-slate-500 italic text-[10px] mt-1">Approve Stage 02 to freeze the pacing outline.</p>
            )}
          </div>

          {/* Stage 03 Locks */}
          <div className={`p-3 rounded border text-xs transition-colors ${is03Approved ? "bg-white/5 border-white/5 border-l-2 border-l-blue-400" : "bg-white/2 border-white/5 opacity-60"}`}>
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-white text-[11px]">03 SCENE CARDS SPLIT</span>
              {is03Approved ? (
                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Check className="w-2.5 h-2.5" /> LOCKED
                </span>
              ) : (
                <span className="text-[9px] font-mono text-slate-500">UNLOCKED</span>
              )}
            </div>
            {is03Approved ? (
              <p className="text-slate-400 font-mono text-[10px] mt-1">
                Detailed scene card matrix locked. Final writer matches scene cards exactly.
              </p>
            ) : (
              <p className="text-slate-500 italic text-[10px] mt-1">Approve Stage 03 to seal scene cards sequence.</p>
            )}
          </div>
        </div>
      </div>

      {/* Avatar Rule Section */}
      <div className="border-t border-white/5 pt-5">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            Strategic Avatar Rule
          </h3>
          <button
            onClick={() => setAvatarCommentaryEnabled(!state.avatarCommentaryEnabled)}
            className="text-slate-400 hover:text-white transition-colors focus:outline-none"
            title={state.avatarCommentaryEnabled ? "Disable Avatar Rule" : "Enable Avatar Rule"}
          >
            {state.avatarCommentaryEnabled ? (
              <ToggleRight className="w-8 h-8 text-blue-500" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-600" />
            )}
          </button>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
          If enabled, the final script must contain <strong className="text-slate-200">exactly three</strong> sharp tactical and psychological commentary lines (<code className="text-blue-400 font-mono">[AVATAR]</code> logs), measuring exactly between 300 and 400 characters each.
        </p>

        {state.avatarCommentaryEnabled ? (
          <div className="bg-white/2 rounded border border-white/5 p-2.5 space-y-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-slate-400">Total detected tracks:</span>
              <span className={`font-bold ${avatarMatches.length === 3 ? "text-emerald-400" : "text-amber-400"}`}>
                {avatarMatches.length} / 3
              </span>
            </div>

            {avatarMatches.length > 0 ? (
              <div className="space-y-1.5 pt-1 border-t border-white/5">
                {avatarMatches.map((m, idx) => (
                  <div key={idx} className="text-[10px] font-mono bg-black/40 p-1.5 rounded space-y-0.5">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-200 font-bold">{m.part}</span>
                      <span className={m.isValid ? "text-emerald-400" : "text-rose-400 font-extrabold"}>
                        {m.length} chars {m.isValid ? "✓" : "✗ (300-400)"}
                      </span>
                    </div>
                    <p className="text-slate-500 italic text-[9px] line-clamp-1">"{m.text}"</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 italic text-center py-2">
                No avatar tracks written yet. They generate inside Parts 3, 6, and 9 automatically.
              </p>
            )}
          </div>
        ) : (
          <div className="text-center p-2.5 border border-dashed border-white/5 text-slate-500 text-[10px] rounded italic">
            Avatar commentary logic disabled.
          </div>
        )}
      </div>

      {/* Outdated Warnings alerts */}
      {state.warnings.length > 0 && (
        <div className="border-t border-white/5 pt-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3.5 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
            Notes & Warnings
          </h3>
          <div className="space-y-2">
            {state.warnings.map((w, i) => (
              <div key={i} className="bg-amber-500/10 text-amber-200 border border-amber-500/20 rounded p-2.5 text-[10px] font-mono leading-relaxed">
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sidebar operational text note */}
      <div className="mt-auto border-t border-white/5 pt-4 text-[11px] text-slate-500 leading-relaxed space-y-2">
        <span className="font-mono text-[9px] text-slate-400 tracking-widest uppercase block mb-1">PRODUCER MEMO</span>
        <p className="text-slate-400">{state.notes}</p>
        <button
          onClick={() => {
            if (window.confirm("Are you sure you want to completely clear this session? Every stage, note, and script part will be permanently lost.")) {
              onClearProject();
            }
          }}
          className="w-full mt-3 py-2 bg-white/5 hover:bg-rose-950/30 text-slate-300 hover:text-rose-400 border border-white/10 hover:border-rose-900 text-[10px] font-mono rounded transition-colors uppercase font-bold"
        >
          Clear Session & Reset
        </button>
      </div>
    </aside>
  );
}

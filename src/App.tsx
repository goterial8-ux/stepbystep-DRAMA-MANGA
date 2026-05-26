import { useState, useEffect, ChangeEvent, useRef } from "react";
import { 
  Sparkles, 
  CheckCircle2, 
  Layers, 
  FileText, 
  Download, 
  Upload, 
  RefreshCw, 
  Copy, 
  Save, 
  Clipboard, 
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Play,
  Check,
  Edit2,
  Trash2,
  Zap,
  XCircle,
  MessageSquare
} from "lucide-react";
import { 
  ProjectState, 
  STAGES_CONFIG, 
  INITIAL_PROJECT_STATE, 
  StageStatus,
  ScriptPart
} from "./types";
import RightPanel from "./components/RightPanel";

export default function App() {
  const [state, setState] = useState<ProjectState>(() => {
    try {
      const saved = localStorage.getItem("scriptforge_project_state");
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure standard structure is verified
        if (parsed && typeof parsed === "object" && "stages" in parsed) {
          // Backward compatibility check to ensure new stages are added
          const mergedStages = { ...INITIAL_PROJECT_STATE.stages, ...parsed.stages };
          return { ...INITIAL_PROJECT_STATE, ...parsed, stages: mergedStages } as ProjectState;
        }
      }
    } catch (e) {
      console.error("Error reading from localStorage:", e);
    }
    return INITIAL_PROJECT_STATE;
  });

  const [apiConfig, setApiConfig] = useState<{ hasApiKey: boolean; model: string }>({
    hasApiKey: true,
    model: "gemini-3.5-flash"
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const isCancelledRef = useRef(false);
  const stateRef = useRef(state);
  
  // Sync stateRef
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [generationError, setGenerationError] = useState<string | null>(null);
  
  // Custom states for active edits and competitor analysis
  const [tempOutput, setTempOutput] = useState("");
  const [tempHandoff, setTempHandoff] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [competitorScriptsText, setCompetitorScriptsText] = useState("");
  const [isExtractingBlueprint, setIsExtractingBlueprint] = useState(false);

  // Active sub-selection inside Stage 04 Script Parts
  const [selectedPartNum, setSelectedPartNum] = useState<number>(1);
  const [isGeneratingPart, setIsGeneratingPart] = useState(false);
  const [showStage00Help, setShowStage00Help] = useState(false);
  const [showStage01Help, setShowStage01Help] = useState(false);
  const [showStage02Help, setShowStage02Help] = useState(false);
  const [showStage03Help, setShowStage03Help] = useState(false);
  const [showStage04Help, setShowStage04Help] = useState(false);

  // Check backend config on mount
  useEffect(() => {
    fetch("/api/health")
      .then(async res => {
        const raw = await res.text();
        try {
          return JSON.parse(raw);
        } catch {
          throw new Error("Backend returned HTML/non-JSON for health check.");
        }
      })
      .then(data => {
        setApiConfig({
          hasApiKey: data.hasApiKey,
          model: "gemini-3.5-flash"
        });
      })
      .catch(err => console.error("Error linking to backend config:", err));
  }, []);

  // Save state to localStorage on modification
  useEffect(() => {
    localStorage.setItem("scriptforge_project_state", JSON.stringify(state));
    // Regenerate out-of-sync warnings based on chronological rule logic
    rebuildWarnings(state);
  }, [state]);

  // Synchronize dynamic editing variables whenever stage changes
  const activeStageConfig = STAGES_CONFIG[state.activeStageIdx];
  const activeStageData = state.stages[activeStageConfig.key];

  useEffect(() => {
    setTempOutput(activeStageData.output);
    setTempHandoff(activeStageData.handoff);
    setIsEditing(false);
  }, [state.activeStageIdx, state.stages]);

  const rebuildWarnings = (current: ProjectState) => {
    const warnings: string[] = [];
    const stages = current.stages;

    // Warning chain logic: If Stage N was edited or regenerated, but Stage N+1 is already drafted or approved
    if (stages["00_idea"].status === "approved") {
      if (stages["01_foundation"].status !== "not_started" && !stages["00_idea"].handoff) {
        warnings.push("00 IDEA Setup was updated without saving a fresh 00 HANDOFF for Foundation DNA.");
      }
    }
    
    // Check if Stage 0 updated while Stage 1 is approved
    if (stages["00_idea"].status === "draft" && stages["01_foundation"].status === "approved") {
      warnings.push("⚠️ Foundation DNA (01) is approved, but the source Idea Setup (00) has reverted to a draft stage!");
    }
    // Check if Stage 1 is draft while Stage 2 is approved
    if (stages["01_foundation"].status === "draft" && stages["02_macro"].status === "approved") {
      warnings.push("⚠️ Macro Outline (02) is approved, but Foundation DNA (01) has reverted to a draft!");
    }
    // Check if Stage 2 is draft while Stage 3 is approved
    if (stages["02_macro"].status === "draft" && stages["03_scenes"].status === "approved") {
      warnings.push("⚠️ Scene Cards (03) is approved, but the Macro Outline (02) has changed!");
    }
    // Check if Stage 3 is draft while Stage 4 is approved
    if (stages["03_scenes"].status === "draft" && current.scriptParts.some(p => p.status === "approved")) {
      warnings.push("⚠️ Parts of your final script are drafted/approved, but the source Scene Cards (03) sequence is currently custom edited.");
    }

    if (JSON.stringify(current.warnings) !== JSON.stringify(warnings)) {
      setState(prev => ({ ...prev, warnings }));
    }
  };

  // 0. Competitor reference extractor tool
  const handleExtractBlueprint = async () => {
    if (!competitorScriptsText.trim()) return;
    setIsExtractingBlueprint(true);
    setGenerationError(null);

    try {
      const res = await fetch("/api/analyze-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitorScripts: competitorScriptsText }),
      });
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("Backend returned non-JSON:", raw);
        throw new Error("Backend returned HTML/non-JSON. Check API route.");
      }
      if (data.error) throw new Error(data.error);

      setState(prev => ({
        ...prev,
        competitorBlueprint: data.blueprint,
        notes: "Competitor reference blueprint extracted! Applied to Stage 00 prompts."
      }));
    } catch (err: any) {
      setGenerationError(err.message || "Could not analyze competitor script.");
    } finally {
      setIsExtractingBlueprint(false);
    }
  };

  // 1-3. Main pipeline generator
  const handleGenerateStage = async (stageFeedback?: string) => {
    const currentState = stateRef.current;
    setIsGenerating(true);
    setGenerationError(null);
    const activeKey = STAGES_CONFIG[currentState.activeStageIdx].key;

    // Gather previously approved handoffs to feed as context
    const previousHandoffs: Record<string, string> = {};
    STAGES_CONFIG.forEach(cfg => {
      if (cfg.id < currentState.activeStageIdx) {
        previousHandoffs[cfg.key] = currentState.stages[cfg.key].handoff;
      }
    });

    try {
      const res = await fetch("/api/generate-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageId: currentState.activeStageIdx,
          rawIdea: currentState.rawIdea,
          competitorBlueprint: currentState.competitorBlueprint,
          previousHandoffs,
          feedback: stageFeedback || currentState.stages[activeKey].feedback
        }),
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("Backend returned non-JSON:", raw);
        throw new Error("Backend returned HTML/non-JSON. Check API route.");
      }
      if (data.error) throw new Error(data.error);

      setState(prev => {
        const nextStages = { ...prev.stages };
        nextStages[activeKey] = {
          ...nextStages[activeKey],
          output: data.output,
          handoff: data.handoff,
          status: "draft",
        };
        return {
          ...prev,
          stages: nextStages,
          notes: `Stage ${activeStageConfig.code} output completed and moved to draft. Review or edit, then click Approve.`
        };
      });
    } catch (err: any) {
      setGenerationError(err.message || "Failed to generate stage.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Stage 04 Generation: Part-by-Part script generator
  const handleGenerateScriptPart = async (partNum: number, partFeedback?: string) => {
    const currentState = stateRef.current;
    setIsGeneratingPart(true);
    setGenerationError(null);

    const part = currentState.scriptParts.find(p => p.number === partNum);
    if (!part) return;

    // Get the Stage 03 Handoff (Scene matrix)
    const sceneCardsHandoff = currentState.stages["03_scenes"].handoff;
    if (!sceneCardsHandoff) {
      setGenerationError("Stage 03 Handoff is required to write final script. Please draft and approve Stage 03 first.");
      setIsGeneratingPart(false);
      return false; // Return success status
    }

    // Capture text and memory of previous generated parts so model maintains continuous tone/narrative
    const previousPartsText: string[] = [];
    currentState.scriptParts.forEach(p => {
      if (p.number < partNum && p.output) {
        let entry = `--- ${p.title} ---\n[LATEST OUTPUT TRUNCATED]:\n${p.output.slice(-2500)}`;
        if (p.memory) {
          entry += `\n[MEMORY AND AVOIDANCE LOG FOR THIS PART]:\n${p.memory}`;
        }
        previousPartsText.push(entry);
      }
    });

    try {
      const res = await fetch("/api/generate-script-part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partNumber: partNum,
          partTitle: part.title,
          sceneCardsHandoff,
          previousPartsOutput: previousPartsText,
          avatarCommentaryEnabled: currentState.avatarCommentaryEnabled,
          competitorScriptsText,
          feedback: partFeedback || part.feedback
        }),
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("Backend returned non-JSON:", raw);
        throw new Error("Backend returned HTML/non-JSON. Check API route.");
      }
      if (data.error) throw new Error(data.error);

      setState(prev => {
        const nextParts = prev.scriptParts.map(p => {
          if (p.number === partNum) {
            return { ...p, output: data.output, memory: data.memory, status: "draft" as StageStatus };
          }
          return p;
        });

        // Auto compile the global 04 stage output
        const combinedOutput = nextParts.map(p => p.output).filter(Boolean).join("\n\n");
        const updatedStages = { ...prev.stages };
        updatedStages["04_script"] = {
          ...updatedStages["04_script"],
          output: combinedOutput,
          handoff: `Total length compiled: ${combinedOutput.length} characters. Consists of ${nextParts.filter(p => p.output).length} parts drafted. Ready for QA linter.`
        };

        return {
          ...prev,
          scriptParts: nextParts,
          stages: updatedStages,
          notes: `${part.title} draft written successfully! Review and edit the script paragraphs above.`
        };
      });
      return true;
    } catch (err: any) {
      setGenerationError(err.message || "Could not generate script part.");
      return false;
    } finally {
      setIsGeneratingPart(false);
    }
  };

  const handleAutoGenerateFullScript = async () => {
    if (isAutoGenerating) return;
    setIsAutoGenerating(true);
    isCancelledRef.current = false;
    setGenerationError(null);

    // Always start with latest data from stateRef
    let currentState = stateRef.current;
    let partsToProcess = currentState.scriptParts.filter(p => p.status !== 'approved');

    for (const part of partsToProcess) {
      if (isCancelledRef.current) break;
      
      setSelectedPartNum(part.number);
      const success = await handleGenerateScriptPart(part.number);
      
      if (!success) {
        setIsAutoGenerating(false);
        return;
      }
      
      // Auto-approve after generation
      handleApproveScriptPart(part.number);
      
      // Small buffer
      await new Promise(r => setTimeout(r, 800));
      
      // Update our local understanding of state for the next check if needed
      // (Though handleGenerateScriptPart now uses stateRef internally)
    }
    
    setIsAutoGenerating(false);
    isCancelledRef.current = false;
  };

  const handleCancelAutoGenerate = () => {
    isCancelledRef.current = true;
    setIsAutoGenerating(false);
    setState(prev => ({ ...prev, notes: "Auto-generation cancelled by user." }));
  };

  const handleClearScriptOnly = () => {
    if (!confirm("Are you sure you want to clear all script parts? The rest of the pipeline will be preserved.")) return;
    setState(prev => {
      const nextParts = prev.scriptParts.map(p => ({ ...p, output: "", status: "not_started" as StageStatus }));
      const nextStages = { ...prev.stages };
      nextStages["04_script"] = { output: "", handoff: "", status: "not_started" as StageStatus };
      return {
        ...prev,
        scriptParts: nextParts,
        stages: nextStages,
        notes: "Script parts cleared successfully."
      };
    });
  };

  // Approve custom script part
  const handleApproveScriptPart = (partNum: number) => {
    setState(prev => {
      const nextParts = prev.scriptParts.map(p => {
        if (p.number === partNum) {
          return { ...p, status: "approved" as StageStatus };
        }
        return p;
      });

      const combinedOutput = nextParts.map(p => p.output).filter(Boolean).join("\n\n");
      const nextStages = { ...prev.stages };
      const allAppoved = nextParts.every(p => p.status === "approved" && p.output);
      nextStages["04_script"] = {
        output: combinedOutput,
        handoff: `Approved compilation of all parts. Characters: ${combinedOutput.length}. Status: ${allAppoved ? 'approved' : 'partial'}`,
        status: allAppoved ? "approved" as StageStatus : "draft" as StageStatus,
      };

      return {
        ...prev,
        scriptParts: nextParts,
        stages: nextStages,
        notes: `Script part approved! Keep generating or proceed to Stage 05 Linter QA once all parts are marked approved.`
      };
    });
  };

  // Stage 05: Linter QA auditor
  const handleRunLinter = async () => {
    setIsGenerating(true);
    setGenerationError(null);

    const fullScript = state.stages["04_script"].output;
    if (!fullScript) {
      setGenerationError("Stage 04 Final Script content is missing. Draft and compile script parts inside Stage 04 first.");
      setIsGenerating(false);
      return;
    }

    try {
      const res = await fetch("/api/run-linter-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          fullScript,
          stage03Handoff: state.stages["03_scenes"]?.handoff || "",
          stage02Handoff: state.stages["02_macro"]?.handoff || "",
          stage01Handoff: state.stages["01_foundation"]?.handoff || "",
          stage00Handoff: state.stages["00_idea"]?.handoff || ""
        }),
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("Backend returned non-JSON:", raw);
        throw new Error("Backend returned HTML/non-JSON. Check API route.");
      }
      if (data.error) throw new Error(data.error);

      setState(prev => {
        const nextStages = { ...prev.stages };
        nextStages["05_linter"] = {
          output: data.report,
          handoff: "Automated linter checks complete. Script fully optimized.",
          status: "draft",
        };
        return {
          ...prev,
          stages: nextStages,
          notes: "QA audit completed. Review flagged defects or apply surgical repair directives at the bottom of the log."
        };
      });
    } catch (err: any) {
      setGenerationError(err.message || "Failed to audit script.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Stage 06: Voiceover Export Cleaner
  const handleRunVoiceoverCleaner = async () => {
    setIsGenerating(true);
    setGenerationError(null);

    const linterReport = state.stages["05_linter"].output;
    const finalScript = state.stages["04_script"].output;

    if (!finalScript) {
      setGenerationError("Final Script content is missing.");
      setIsGenerating(false);
      return;
    }

    if (state.stages["05_linter"].status === "not_started") {
      setGenerationError("Please run Stage 05 Linter QA before running Voiceover Export Cleaner.");
      setIsGenerating(false);
      return;
    }

    try {
      const res = await fetch("/api/run-voiceover-cleaner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          approvedFinalScript: finalScript,
          approvedDomainVocabulary: "General default vocabulary",
          forbiddenVocabulary: "Exclude any non-approved domain items.",
          exportMode: "A. Keep part headings. Keep avatar tags."
        }),
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("Backend returned non-JSON:", raw);
        throw new Error("Backend returned HTML/non-JSON. Check API route.");
      }
      if (data.error) throw new Error(data.error);

      setState(prev => {
        const nextStages = { ...prev.stages };
        nextStages["06_cleaner"] = {
          output: data.cleanedScript,
          handoff: "Ready for voiceover recording and video production.",
          status: "draft",
        };
        return {
          ...prev,
          stages: nextStages,
          notes: "Voiceover cleanup completed. You can now use this text for narration."
        };
      });
    } catch (err: any) {
      setGenerationError(err.message || "Failed to clean script for voiceover.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper actions: Edit, Save, Approve
  const handleApproveStage = () => {
    const key = activeStageConfig.key;
    setState(prev => {
      const nextStages = { ...prev.stages };
      nextStages[key] = {
        ...nextStages[key],
        status: "approved",
      };
      return {
        ...prev,
        stages: nextStages,
        notes: `Approved Stage ${activeStageConfig.code} - ${activeStageConfig.name}! All structures validated.`
      };
    });
  };

  const handleUnlockStage = () => {
    const key = activeStageConfig.key;
    setState(prev => {
      const nextStages = { ...prev.stages };
      nextStages[key] = {
        ...nextStages[key],
        status: "draft",
      };
      return {
        ...prev,
        stages: nextStages,
        notes: `Unlocked Stage ${activeStageConfig.code}! You can now modify the outputs dynamically.`
      };
    });
  };

  const handleSaveEdits = () => {
    const key = activeStageConfig.key;
    setState(prev => {
      const nextStages = { ...prev.stages };
      nextStages[key] = {
        ...nextStages[key],
        output: tempOutput,
        handoff: tempHandoff,
      };
      return {
        ...prev,
        stages: nextStages,
        notes: "Modifications and handoffs successfully stored!"
      };
    });
    setIsEditing(false);
  };

  // Save active script part changes
  const handleSavePartEdits = (partNum: number, text: string) => {
    setState(prev => {
      const nextParts = prev.scriptParts.map(p => {
        if (p.number === partNum) {
          return { ...p, output: text, status: "draft" as StageStatus };
        }
        return p;
      });
      // Compile global 04 stage output
      const combinedOutput = nextParts.map(p => p.output).filter(Boolean).join("\n\n");
      const nextStages = { ...prev.stages };
      nextStages["04_script"] = {
        ...nextStages["04_script"],
        output: combinedOutput,
        handoff: `Total length compiled: ${combinedOutput.length} characters. Consists of ${nextParts.filter(p => p.output).length} parts drafted.`
      };

      return {
        ...prev,
        scriptParts: nextParts,
        stages: nextStages,
        notes: "Script Part modifications successfully stored!"
      };
    });
  };

  // Import/Export functionality
  const handleExportProject = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `scriptforge_project_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportProject = (e: ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = event => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed && typeof parsed === "object" && "stages" in parsed) {
            setState(parsed as ProjectState);
            alert("Project successfully imported!");
          } else {
            alert("Invalid JSON schema for ScriptForge file.");
          }
        } catch (err) {
          alert("Could not parse exported JSON file.");
        }
      };
    }
  };

  const handleExportFullTxt = () => {
    const compiledTxt = state.scriptParts
      .map(part => `=== ${part.title} ===\n\n${part.output}`)
      .join("\n\n\n");

    const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(compiledTxt);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `scriptforge_full_script_${new Date().toISOString().slice(0, 10)}.txt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleCopyHandoff = () => {
    navigator.clipboard.writeText(tempHandoff);
    alert("Handoff Package copied to clipboard!");
  };

  // Start back to raw idea
  const handleClearProject = () => {
    localStorage.removeItem("scriptforge_project_state");
    setState(INITIAL_PROJECT_STATE);
  };

  // State calculations
  const calculateTotalScriptChars = () => {
    const total = state.scriptParts.reduce((acc, p) => acc + (p.output ? p.output.length : 0), 0);
    return total;
  };

  return (
    <div className="flex h-screen w-screen bg-[#0A0B0E] font-sans text-slate-300 overflow-hidden" id="scriptforge-main-container">
      {/* Left Pipeline Sidebar */}
      <aside className="w-72 border-r border-white/10 bg-[#0F1115] flex flex-col justify-between" id="scriptforge-left-sidebar">
        <div>
          {/* Header */}
          <div className="p-5 border-b border-white/5 bg-gradient-to-b from-white/2 to-transparent">
            <h1 className="text-md font-bold tracking-wider text-white flex items-center gap-2 uppercase">
              <span className="w-2.5 h-2.5 bg-blue-500 rounded-sm rotate-45"></span>
              ScriptForge
            </h1>
            <p className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-widest">
              Producer Pipeline v2.4
            </p>
          </div>

          {/* Pipeline stages checklist */}
          <nav className="p-3 select-none flex flex-col gap-1.5">
            <span className="text-[9px] font-mono text-slate-500 px-2 tracking-widest uppercase mb-2 block">
              Producer Pipeline
            </span>
            {STAGES_CONFIG.map((cfg, idx) => {
              const stageData = state.stages[cfg.key];
              const isSelected = state.activeStageIdx === idx;
              
              let cardBgClasses = "bg-transparent border-transparent text-slate-400 hover:bg-white/5";
              if (isSelected) {
                cardBgClasses = "bg-blue-500/10 border-blue-500/30 text-white ring-1 ring-blue-500/10";
              } else if (stageData.status === "approved") {
                cardBgClasses = "bg-emerald-500/5 border-emerald-500/10 text-emerald-100 hover:bg-[#13151A] hover:border-white/10 opacity-70 hover:opacity-100";
              } else if (stageData.status === "draft") {
                cardBgClasses = "bg-amber-500/5 border-amber-500/10 text-amber-200 hover:bg-[#13151A] hover:border-white/10 opacity-70 hover:opacity-100";
              } else {
                cardBgClasses = "bg-transparent border-transparent text-slate-500 hover:bg-white/2 opacity-50 hover:opacity-100";
              }

              const statusBadges: Record<StageStatus, { bg: string; text: string }> = {
                not_started: { bg: "text-slate-500 border border-white/5 bg-white/2", text: "Locked" },
                draft: { bg: "text-amber-400 border border-amber-500/20 bg-amber-500/5", text: "Drafting" },
                approved: { bg: "text-emerald-400 border border-emerald-500/20 bg-emerald-500/5", text: "Approved" },
                needs_repair: { bg: "text-rose-400 border border-rose-500/20 bg-rose-500/5", text: "Repair" },
              };

              const activeBadge = statusBadges[stageData.status];

              return (
                <button
                  key={cfg.id}
                  onClick={() => setState(prev => ({ ...prev, activeStageIdx: idx }))}
                  className={`w-full group text-left rounded p-3 border transition-all duration-150 flex flex-col gap-1 focus:outline-none ${cardBgClasses}`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="font-mono text-[9px] font-bold tracking-widest text-slate-500 group-hover:text-blue-400">
                      {cfg.code}
                    </span>
                    <span className={`text-[8px] uppercase font-bold px-1.5 py-0.5 rounded ${activeBadge.bg}`}>
                      {activeBadge.text}
                    </span>
                  </div>
                  <span className="text-xs font-semibold truncate group-hover:text-white">
                    {cfg.name}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sync panel options */}
        <div className="p-4 border-t border-white/5 bg-black/10 flex flex-col gap-2">
          {/* Missing API Key warning banner */}
          {!apiConfig.hasApiKey && (
            <div className="bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded text-[10px] text-amber-500 flex flex-col gap-1 mb-2 leading-relaxed font-mono">
              <span className="font-bold uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Key Offline
              </span>
              <p>
                Vertex AI configuration is missing. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.
              </p>
            </div>
          )}

          <div className="text-[10px] text-slate-500 uppercase tracking-widest px-1">Current Workspace</div>
          <div className="text-xs font-medium text-slate-200 truncate px-1 mb-2">
            Inheritance: The Silent War
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleExportProject}
              className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 py-1.5 rounded text-[10px] uppercase font-bold text-slate-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none"
              title="Export Full Project JSON"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" /> Export JSON
            </button>
            <label className="flex-1 bg-white/5 border border-white/10 hover:bg-white/10 py-1.5 rounded text-[10px] uppercase font-bold text-slate-200 transition-colors cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none">
              <Upload className="w-3.5 h-3.5 text-slate-400" /> Import JSON
              <input type="file" onChange={handleImportProject} className="hidden" accept=".json" />
            </label>
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main className="flex-1 bg-[#0A0B0E] flex flex-col overflow-hidden" id="scriptforge-main-workspace">
        {/* Workspace Top Header */}
        <header className="h-14 border-b border-white/5 bg-[#0F1115]/50 backdrop-blur-md px-6 flex items-center justify-between" id="scriptforge-workspace-header">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded select-none">
              STAGE {activeStageConfig.code}
            </span>
            <h2 className="text-xs font-bold text-white tracking-widest uppercase">
              {activeStageConfig.name}
            </h2>
            <div className="h-4 w-px bg-white/10"></div>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest hidden md:inline">PROMPT_TEMPLATE: DRAMA_9_PART_V4</span>
          </div>

          <div className="flex items-center gap-3">
            {state.stages["04_script"].output && (
              <button
                onClick={handleExportFullTxt}
                className="px-4 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-[10px] uppercase tracking-wider font-bold text-slate-200 rounded flex items-center gap-1.5 transition-all focus:outline-none"
              >
                <FileText className="w-3.5 h-3.5 text-slate-400" /> Export Full Script .txt
              </button>
            )}
          </div>
        </header>

        {/* Global Error message */}
        {generationError && (
          <div className="bg-rose-950/50 border-b border-rose-900/50 p-3 px-6 text-xs text-rose-300 flex items-center justify-between font-mono animate-fade-in">
            <span className="flex items-center gap-2">⚠️ ERROR: {generationError}</span>
            <button 
              onClick={() => setGenerationError(null)}
              className="text-[10px] hover:text-white underline uppercase tracking-widest focus:outline-none"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Main stage details workspace */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6" id="scriptforge-stage-body">
          {/* OPTIONAL: Competitor Blueprints Analyser drawer layout inside Stage 00 */}
          {state.activeStageIdx === 0 && (
            <section className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-2xl relative overflow-hidden flex flex-col gap-4">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  Reference Analysis Mode
                </h3>
                <p className="text-xs text-zinc-500">
                  Runs before Stage 00. Analyze real competitor script styles to locked matching pacing blueprint rhythm.
                </p>
              </div>

              <textarea
                value={competitorScriptsText}
                onChange={(e) => setCompetitorScriptsText(e.target.value)}
                placeholder="Paste raw competitor video script or dialogue logs here..."
                rows={3}
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-800 transition-all resize-y"
              />

              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={handleExtractBlueprint}
                  disabled={isExtractingBlueprint || !competitorScriptsText.trim()}
                  className="py-1.5 px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono font-bold text-zinc-100 rounded-lg flex items-center gap-2"
                >
                  {isExtractingBlueprint ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  {state.competitorBlueprint ? "Re-Extract Blueprint" : "Extract Style Blueprint"}
                </button>

                {state.competitorBlueprint && (
                  <span className="text-[10px] font-mono text-emerald-400 font-semibold bg-emerald-950/40 px-2 py-1 rounded border border-emerald-950/40">
                    Style Blueprint Active & Injected
                  </span>
                )}
              </div>

              {state.competitorBlueprint && (
                <div className="mt-2 bg-black/40 border border-white/5 p-4 rounded text-xs font-mono text-slate-400 max-h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  <strong className="text-white block mb-2 uppercase text-[10px] tracking-wider text-blue-400">Extracted Style Blueprint:</strong>
                  {state.competitorBlueprint}
                </div>
              )}
            </section>
          )}

          {/* Core Input Block for current Stage */}
          <section className="bg-[#13151A] border border-white/10 rounded-lg p-5 shadow-2xl flex flex-col gap-4">
            <h3 className="text-[10px] font-mono tracking-wider text-slate-500 uppercase">
              Pipeline Entry Inputs
            </h3>

            {state.activeStageIdx === 0 ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs text-slate-400 font-medium">Drama Story Raw Idea Brief</label>
                <textarea
                  value={state.rawIdea}
                  onChange={(e) => setState(prev => ({ ...prev, rawIdea: e.target.value }))}
                  placeholder="Insert core narrative premise, creators involved, escalation sequence, proof objects, and desired climax outcome..."
                  rows={4}
                  className="w-full bg-[#0A0B0E]/60 border border-white/5 rounded p-3.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/10 transition-all resize-y"
                />
              </div>
            ) : (
              <div className="bg-black/30 border border-white/5 p-3 rounded text-xs font-mono text-slate-400 space-y-1.5">
                <p className="text-slate-500 font-bold uppercase text-[9px] tracking-wider">Context Source File (Predecessor handoff):</p>
                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-400 p-2 bg-[#0A0B0E]/65 rounded border border-white/5">
                  {state.activeStageIdx > 0 
                    ? state.stages[STAGES_CONFIG[state.activeStageIdx - 1].key].handoff || "No previous stage handoff active. Please approve previous stage to populate this data." 
                    : "No predecessor path active."
                  }
                </div>
              </div>
            )}

            {state.activeStageIdx === 0 && (
              <div className="border border-white/5 bg-[#0F1115]/85 rounded-lg p-3.5 font-sans text-xs flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowStage00Help(!showStage00Help)}
                  className="flex items-center justify-between text-blue-400 hover:text-blue-300 font-mono tracking-wider font-bold text-[11px] focus:outline-none w-full text-left"
                >
                  <span className="flex items-center gap-1.5 uppercase">
                    💡 Stage 00 (Idea Setup) Reference Example
                  </span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{showStage00Help ? "COLLAPSE ▲" : "EXPAND ▼"}</span>
                </button>
                {showStage00Help && (
                  <div className="mt-3 text-slate-400 bg-black/60 border border-white/5 p-4 rounded-lg font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text selection:bg-blue-500/30">
                    <div className="text-white font-bold mb-3 border-b border-white/10 pb-1 uppercase tracking-wider text-[11px] text-blue-300">
                      COMPACT EXAMPLE 00 IDEA SETUP
                    </div>
{`Project:
System Billionaire / Admin System Revenge

==================================================
1. RAW IDEA CLEANUP
==================================================

Clean premise:
Kai Ren is a poor programmer whose best friend Damon suddenly receives a Billionaire System, becomes rich overnight, steals Kai’s girlfriend Mira, and humiliates Kai as an NPC.

Hidden twist:
Kai secretly recognizes the system as an old beta architecture he created. Damon thinks the rewards are free gifts, but they are actually hidden liabilities.

Central conflict:
Damon uses visible system status to take Kai’s girl, his public dignity, and later his project, while Kai quietly collects proof of Damon’s violations.

Final revenge promise:
Damon’s rewards convert into debt after he publicly violates core protocol, and Kai is revealed as the original system architect.

==================================================
2. CORE HOOK
==================================================

Hook:
My best friend got a Billionaire System and stole my girlfriend, but he did not know every reward was secretly becoming debt.

Why it works:
It has betrayal, status reversal, hidden power, system fantasy, and a clear final collapse promise.

Viewer promise:
The viewer waits to see Damon’s fake billionaire identity turn into public debt.

==================================================
3. DEVELOPED STORY DNA
==================================================

Unique identity:
Fake chosen user versus true system architect.

Main power arena:
System interface, startup status, investor validation, public screens, admin logs, reward contracts, and liability records.

What Kai understands:
The system does not give free wealth. It creates conditional rewards that become liabilities after protocol abuse.

What Damon misunderstands:
He thinks the system chose him as the main character, when he is only a beta user inside rules he never read.

What the audience waits for:
The moment Damon realizes every flex was logged as evidence.

==================================================
4. PROTAGONIST SETUP
==================================================

Public identity:
Broke failed programmer.

Hidden value:
Original architect of the beta Billionaire System.

Emotional wound:
His girlfriend, friend, and crowd judge him by visible status instead of real authorship.

Main skill:
System architecture, backend logic, proof collection, strategic patience.

Why he does not win immediately:
Admin review can activate only after Damon violates core protocol himself.

Dignity to regain:
Kai must be recognized as the real creator, not just the abandoned boyfriend.

==================================================
5. ANTAGONIST SETUP
==================================================

Public mask:
System-chosen billionaire.

False belief:
Visible rewards equal real power and destiny.

Temporary power:
Money displays, elite access, public attention, and system-generated status.

Real weakness:
Damon can use the interface but does not understand the architecture or debt layer.

How he destroys himself:
His need to prove he is chosen makes him abuse the system publicly.

==================================================
6. BETRAYER SETUP
==================================================

Betrayer:
Mira Hale, Kai’s girlfriend.

Wrong choice:
She chooses Damon’s visible system status over Kai’s hidden value.

Why it makes sense to her:
Damon looks like safety, destiny, and public success. Kai looks like struggle.

Why it is morally ugly:
She does not only leave Kai. She helps humiliate him and validates Damon’s fake identity.

Regret rule:
Mira must not regret early. She should first double down, then doubt, deny, fear, and only later break under proof.

==================================================
7. TRUE ALLY DIRECTION
==================================================

True ally:
Selena Cross, technology investor or system-security expert.

Function:
She recognizes real architecture, tests Kai’s knowledge, and validates proof publicly.

Contrast:
Mira follows status. Selena follows competence.

Rule:
Selena must not be just a new girlfriend. Her main function is proof and credibility.

==================================================
8. OPENING DEVELOPMENT
==================================================

Opening Option One:
Startup Demo Hijack.

First visual:
Kai’s unfinished demo screen is overwritten by Damon’s Billionaire System interface.

Surface:
Startup pitch room or investor demo event.

Humiliation:
Damon takes the spotlight and Mira publicly moves to his side.

First proof clue:
Kai notices an old beta build line in Damon’s interface.

Similarity risk:
Low.

Opening Option Two:
Access Denial at Tech Event.

First visual:
Kai’s badge fails at the entrance while Damon enters as a VIP system-backed founder.

Surface:
Tech summit access gate.

Humiliation:
Kai is treated like a nobody at his own industry event.

First proof clue:
The access system shows backend behavior Kai recognizes.

Similarity risk:
Medium.

Opening Option Three:
Public Product Launch Theft.

First visual:
Damon presents Kai’s concept as a system-generated breakthrough.

Surface:
Public launch stage.

Humiliation:
Kai watches his own idea praised under Damon’s name.

First proof clue:
Damon misuses one architecture term.

Similarity risk:
Medium.

Selected opening:
Startup Demo Hijack.

Why:
It directly connects betrayal, technology, public status, system proof, and stolen attention without using gala or luxury clichés.

==================================================
9. FUNCTION VS SURFACE
==================================================

Opening function:
Public humiliation, wrong choice, hidden advantage, first proof, and status gap.

Surface to use:
Tech demo, startup pitch, interface reveal, investor room, access control.

Surfaces to avoid:
Gala, red carpet, helicopter entrance, luxury-store card decline, generic billionaire party.

==================================================
10. TROPE MIX
==================================================

Main trope:
Fake chosen one versus true architect.

Secondary trope:
Best friend betrayal.

Emotional trope:
The man she called an NPC wrote the system they worship.

Power-system trope:
System rewards as hidden liabilities.

Betrayer trope:
Girlfriend chooses visible status over real value.

Proof trope:
Admin logs and public system review.

Final collapse trope:
Rewards convert into debt.

==================================================
11. PROOF SYSTEM
==================================================

Early proof:
Kai sees beta architecture inside Damon’s interface.

Midpoint proof:
Damon fails to control or explain a stolen technical project.

Late proof:
Mira’s co-beneficiary signature connects her to Damon’s reward chain.

Final proof:
Public admin review reveals liabilities, protocol violations, and Kai’s architect authority.

Visual proof objects:
Interface screens, logs, access failures, signatures, reward records, public review display.

==================================================
12. FINAL COLLAPSE PROMISE
==================================================

Damon tries to make one huge public control move to prove he is untouchable.

That action triggers admin review.

The system reveals that Damon’s rewards were liabilities, his luxury was conditional, and his protocol violations were logged.

Kai is revealed as the original architect.

Mira realizes she did not choose a king. She signed herself near a debt machine.

==================================================
13. TEMPLATE RISK CHECK
==================================================

Risk:
Generic rich guy steals girlfriend.

Prevention:
Focus on system architecture, hidden liabilities, and admin proof.

Risk:
Kai too overpowered.

Prevention:
He cannot act until Damon violates protocol.

Risk:
Damon too stupid.

Prevention:
Make him socially clever but technically shallow.

Risk:
Mira regrets too early.

Prevention:
Make her double down before proof shock.

Risk:
Too many luxury flexes.

Prevention:
Each flex must create a new proof consequence.

==================================================
14. STAGE 00 DECISION
==================================================

A. APPROVED FOR 01 FOUNDATION DNA.

Reason:
The idea has a clear hook, strong betrayal, unique system logic, visual proof system, gradual regret potential, and a final collapse caused by the antagonist’s own actions.

==================================================
15. HANDOFF TO 01 FOUNDATION DNA
==================================================

Clean premise:
A fake system billionaire steals the hero’s girlfriend and status, but the hero secretly created the system and knows every reward is becoming debt.

Selected opening:
Startup Demo Hijack.

Story DNA:
Fake chosen user versus true system architect.

Protagonist wound:
Kai is judged as worthless because he lacks visible system status.

Antagonist false belief:
Damon believes rewards equal ownership and destiny.

Betrayer false belief:
Mira believes public system validation proves real value.

Hidden advantage:
Kai understands the beta architecture and liability layer.

Proof system:
Admin logs, interface behavior, access tests, signatures, public system review.

True ally direction:
Selena Cross validates real architecture and contrasts with Mira’s status blindness.

Final collapse promise:
Damon’s rewards convert into debt after public protocol violation.

Surfaces to avoid:
Gala, red carpet, helicopter, luxury-store card decline, generic billionaire party.

Key originality rule:
Every major scene must come from system logic, tech status, proof, access, or public interface consequences.

Main risk for Stage 01:
Do not make Kai instantly omnipotent. His victory must come from Damon’s self-exposure.`}
                  </div>
                )}
              </div>
            )}

            {state.activeStageIdx === 1 && (
              <div className="border border-white/5 bg-[#0F1115]/85 rounded-lg p-3.5 font-sans text-xs flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowStage01Help(!showStage01Help)}
                  className="flex items-center justify-between text-blue-400 hover:text-blue-300 font-mono tracking-wider font-bold text-[11px] focus:outline-none w-full text-left"
                >
                  <span className="flex items-center gap-1.5 uppercase">
                    💡 Stage 01 (Foundation DNA) Reference Example
                  </span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{showStage01Help ? "COLLAPSE ▲" : "EXPAND ▼"}</span>
                </button>
                {showStage01Help && (
                  <div className="mt-3 text-slate-400 bg-black/60 border border-white/5 p-4 rounded-lg font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text selection:bg-blue-500/30">
                    <div className="text-white font-bold mb-3 border-b border-white/10 pb-1 uppercase tracking-wider text-[11px] text-blue-300">
                      COMPACT EXAMPLE 01 FOUNDATION DNA
                    </div>
{`Project:
System Billionaire / Admin System Revenge

==================================================
1. STAGE 00 HANDOFF RECAP
==================================================

Premise:
Kai is a poor programmer whose best friend Damon receives a Billionaire System, becomes rich overnight, steals Kai’s girlfriend Mira, and humiliates him as an NPC.

Opening:
Startup Demo Hijack. Kai’s demo is overwritten by Damon’s system-sponsored entrance, and Mira publicly moves to Damon’s side.

Core DNA:
Damon looks chosen by the system, but Kai secretly understands the system because he created the beta architecture.

Proof System:
Admin logs, hidden liability records, failed access tests, co-beneficiary signature, public system review.

Final Collapse:
Damon’s rewards convert into debt after he violates core protocol in public.

Surfaces to avoid:
Gala, red carpet, helicopter entrance, luxury-store card decline, generic billionaire party.

==================================================
2. CHARACTER FUNCTION LOCK
==================================================

Protagonist — Kai Ren

Public identity:
Poor failed programmer.

Hidden value:
Original architect of the beta Billionaire System.

Wound:
His intelligence and authorship are ignored because he lacks visible money and status.

Restraint:
He cannot revoke Damon instantly. Damon must violate core protocol himself.

How he wins:
Kai collects proof while Damon turns every flex into a logged violation.

Antagonist — Damon Vale

Public mask:
System-chosen billionaire.

False belief:
Visible rewards mean real ownership and destiny.

Weakness:
He can use the interface, but he does not understand the architecture or debt layer.

Escalation logic:
Every status crack makes him spend more, steal more, and perform harder.

Betrayer — Mira Hale

Desire:
Security, status, and public validation.

Wrong choice:
She chooses Damon’s visible system power over Kai’s hidden real value.

Why it is ugly:
She does not only leave Kai. She helps make him look worthless.

Regret path:
Arrogance first, then doubt, denial, fear, proof shock, bargaining, rejection.

True Ally — Selena Cross

Function:
Recognition ally and technology authority.

Purpose:
She tests Kai, recognizes real architecture, and later validates proof publicly.

Not a trophy:
Her role is proof, competence, and credibility before romance.

==================================================
3. CORE EMOTIONAL CHAIN
==================================================

Initial injustice:
Kai is humiliated as an NPC while Damon becomes the system’s new star.

Wrong choice:
Mira chooses Damon because the crowd and system validate him.

Hero’s silent advantage:
Kai notices the system is his old beta build.

First crack:
A Damon reward succeeds publicly but appears as hidden liability in the backend.

First payoff:
Selena notices Kai understands something Damon cannot explain.

Midpoint proof:
Damon’s stolen project fails because he lacks root understanding.

Enemy counterattack:
Damon accuses Kai of sabotage and tries to isolate him.

Final trap:
Damon attempts a massive public control move to prove he is untouchable.

Final collapse:
The system activates admin review and converts rewards into debt.

Restored dignity:
Kai is revealed as the original architect and refuses Mira’s late apology.

==================================================
4. PROTAGONIST CONTROL LOGIC
==================================================

Kai appears to lose:
Mira, public respect, project control, social status.

Kai secretly gains:
Damon’s public commitments, reward logs, protocol violations, Mira’s signature trail.

Limitation:
He cannot expose the full truth until Damon creates undeniable public proof.

Control becomes visible:
Kai predicts system errors, Selena begins trusting him, and Damon’s victories begin creating hidden costs.

==================================================
5. BETRAYER REGRET LADDER
==================================================

Arrogance:
Mira believes Damon is chosen by destiny.

Irritation:
Kai does not beg or break down.

Doubt:
Damon avoids technical questions.

Denial:
She tells herself powerful people always have enemies.

Fear:
System rewards begin showing strange conditions.

Proof shock:
She sees that rewards are liabilities.

Bargaining:
She claims she was misled.

Rejection:
Kai refuses to take her back.

Consequence:
She loses the status she chose.

==================================================
6. ANTAGONIST ESCALATION LADDER
==================================================

Arrogance:
Damon believes he is the main character.

First irritation:
Kai’s calmness ruins the feeling of victory.

Public crack:
Damon cannot answer a technical question.

Overcompensation:
He spends more and performs louder.

Theft:
He claims Kai’s project as system-generated genius.

Counterattack:
He accuses Kai of sabotage.

Desperate gamble:
He tries to buy control over a company or platform.

Self-destruction:
The public control attempt triggers admin review.

==================================================
7. HIDDEN CARD SCHEDULE
==================================================

Hidden Card One:
Kai created the beta system.

Hint:
Kai recognizes old interface behavior.

Partial reveal:
Selena notices Kai understands backend logic.

Public reveal:
Final system review.

Hidden Card Two:
Rewards are liabilities.

Hint:
First luxury reward contains hidden debt language.

Partial reveal:
A purchase creates strange conditions.

Public reveal:
Final reward-to-debt conversion.

Hidden Card Three:
Mira’s co-beneficiary status links her to Damon’s debt.

Hint:
She signs public partner status.

Partial reveal:
A warning mentions shared benefits.

Public reveal:
Final collapse.

==================================================
8. PROOF SYSTEM LOCK
==================================================

Early proof:
Hidden liability marker in Damon’s first system reward.

Midpoint proof:
Damon fails to run or explain stolen architecture.

Late proof:
Mira’s co-beneficiary record connects her to the liability chain.

Final proof:
Public admin review converts rewards into debt and reveals Kai as original architect.

Proof must be shown through:
screens, logs, access tests, signatures, public system review.

==================================================
9. FACE-SLAP VARIATION MAP
==================================================

Social:
Selena treats Kai as valuable while the crowd calls him NPC.

Technical:
Damon fails a system architecture test.

Financial:
Rewards begin showing debt consequences.

Romantic:
Mira sees Damon panic while Kai stays accurate.

Legal:
Co-beneficiary status becomes liability.

Final systemic:
The system itself exposes Damon.

==================================================
10. PACING AND RETENTION NOTES
==================================================

First payoff:
Kai should notice hidden debt logic very early.

Midpoint:
Damon’s fake genius must crack publicly.

Regret:
Mira should not regret too early. She should double down first.

Antagonist panic:
Begins after technical proof threatens Damon’s chosen-one identity.

Finale:
Save Kai’s full architect reveal and Damon’s full debt conversion for the end.

==================================================
11. FOUNDATION RISK CHECK
==================================================

Risk:
Kai may feel too overpowered.

Prevention:
He cannot revoke Damon until protocol violation.

Risk:
Damon may feel stupid.

Prevention:
Make him socially clever but technically shallow.

Risk:
Mira may regret too early.

Prevention:
Let her rationalize Damon until proof becomes impossible to ignore.

Risk:
Too many money flexes.

Prevention:
Use varied face-slaps: social, technical, financial, romantic, legal, systemic.

==================================================
12. STAGE 01 FINAL DECISION
==================================================

A. APPROVED FOR 02 MACRO OUTLINE.

Reason:
Character logic, regret progression, hidden cards, proof system, and final collapse are clear enough for a detailed nine-part plan.

==================================================
13. HANDOFF PACKAGE TO 02 MACRO OUTLINE
==================================================

Story DNA:
Fake chosen billionaire versus true system architect.

Character Summary:
Kai is the erased architect. Damon is the fake system user. Mira is the status-driven betrayer. Selena is the recognition ally.

Protagonist Control:
Kai appears weak but collects proof while Damon creates violations.

Regret Ladder:
Mira moves from arrogance to doubt, fear, proof shock, bargaining, and rejection.

Antagonist Escalation:
Damon flexes, steals, counterattacks, then attempts public control and destroys himself.

Hidden Cards:
Kai created the system.
Rewards are liabilities.
Mira is linked through co-beneficiary status.
Damon must violate protocol before review.

Proof Lock:
Admin logs, liability markers, failed architecture test, co-beneficiary signature, public admin review.

Face-Slaps:
Social, technical, financial, romantic, legal, final systemic.

Key Rule for Stage 02:
Build the nine-part plan around escalating proof, not repeated luxury flexes.`}
                  </div>
                )}
              </div>
            )}

            {state.activeStageIdx === 2 && (
              <div className="border border-white/5 bg-[#0F1115]/85 rounded-lg p-3.5 font-sans text-xs flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowStage02Help(!showStage02Help)}
                  className="flex items-center justify-between text-blue-400 hover:text-blue-300 font-mono tracking-wider font-bold text-[11px] focus:outline-none w-full text-left"
                >
                  <span className="flex items-center gap-1.5 uppercase">
                    💡 Stage 02 (Macro Outline) Planning Guidelines
                  </span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{showStage02Help ? "COLLAPSE ▲" : "EXPAND ▼"}</span>
                </button>
                {showStage02Help && (
                  <div className="mt-3 text-slate-400 bg-black/60 border border-white/5 p-4 rounded-lg font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text selection:bg-blue-500/30">
                    <div className="text-white font-bold mb-3 border-b border-white/10 pb-1 uppercase tracking-wider text-[11px] text-blue-300">
                      COMPACT EXAMPLE 02 MACRO OUTLINE
                    </div>
{`Project:
System Billionaire / Admin System Revenge

==================================================
1. STAGE 01 HANDOFF RECAP
==================================================

Story DNA:
Fake chosen system user versus true system architect.

Protagonist:
Kai Ren, publicly a failed programmer, secretly the original architect of the beta Billionaire System.

Antagonist:
Damon Vale, fake system-chosen billionaire who can use rewards but does not understand system rules.

Betrayer:
Mira Hale, Kai’s girlfriend, who chooses visible system status over real hidden value.

True Ally:
Selena Cross, technology investor and system-security expert who recognizes real architecture.

Hidden Cards:
One. Kai created the beta system.
Two. Damon’s rewards are hidden liabilities.
Three. Mira’s co-beneficiary status links her to Damon’s debt.
Four. Damon must violate core protocol before admin review activates.

Proof System:
Admin logs, reward liability markers, failed architecture tests, co-beneficiary signature, public admin review.

Final Collapse:
Damon attempts a massive public control move. The system activates admin review, converts rewards into debt, and reveals Kai as original architect.

Surfaces to avoid:
Gala, red carpet, helicopter entrance, generic billionaire party, luxury-store card decline.

Key rule:
Build the nine parts around escalating proof, not repeated luxury flexes.

==================================================
2. FINAL SCRIPT LENGTH PLAN
==================================================

Total target:
One hundred twenty thousand to one hundred thirty thousand characters including spaces.

Part One:
Target: fourteen thousand to fifteen thousand five hundred characters.
Estimated scenes: six.
Drama weight: high.
Reason: hook, first humiliation, Mira’s wrong choice, first hidden system clue.

Part Two:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Estimated scenes: five.
Drama weight: medium-high.
Reason: first reward, first debt clue, first consequence.

Part Three:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Estimated scenes: five.
Drama weight: medium.
Reason: Selena recognizes Kai’s system understanding.

Part Four:
Target: thirteen thousand five hundred to fourteen thousand five hundred characters.
Estimated scenes: five.
Drama weight: medium-high.
Reason: Damon steals Kai’s project and overextends.

Part Five:
Target: fourteen thousand to fifteen thousand five hundred characters.
Estimated scenes: six.
Drama weight: high.
Reason: midpoint public failure and first major crack.

Part Six:
Target: thirteen thousand to fourteen thousand characters.
Estimated scenes: five.
Drama weight: medium-high.
Reason: Damon counterattacks and Kai pays a cost.

Part Seven:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Estimated scenes: five.
Drama weight: medium-high.
Reason: hidden cards align and Mira’s liability risk appears.

Part Eight:
Target: fourteen thousand to fifteen thousand five hundred characters.
Estimated scenes: six.
Drama weight: high.
Reason: final trap closes during Damon’s public control move.

Part Nine:
Target: fifteen thousand to sixteen thousand five hundred characters.
Estimated scenes: six.
Drama weight: high.
Reason: admin review, debt conversion, architect reveal, Mira rejection.

==================================================
3. FINAL SCRIPT WRITING CONTRACT BY PART
==================================================

Global Stage 04 rules:
Normal paragraphs must be between one hundred twenty and two hundred twenty characters including spaces.
All numbers must be written as words.
Symbols must be written as words or removed naturally.
The full script must include exactly three [AVATAR] lines if avatar commentary is enabled.
Each avatar text after the tag must be between three hundred and four hundred characters.

Part One writing direction:
Fast hook, public humiliation, controlled emotional pain. Dialogue low to medium. Show interface proof visually. Avoid long explanation.

Part Two writing direction:
Viewer superiority. Damon looks victorious, but Kai sees debt logic. Keep dopamine beats frequent and concrete.

Part Three writing direction:
More intellectual tension. Selena tests Kai and Damon. Dialogue controlled-high, but proof should come from system behavior, not speeches.

Part Four writing direction:
Professional theft and anger. Damon claims Kai’s project. Avoid making this only a talking scene; use demo failure clues.

Part Five writing direction:
Midpoint public crack. Higher speed, public tension, visible system failure. This part needs a major face-slap.

Part Six writing direction:
Pressure and cost. Damon frames Kai. Kai should not look passive; he must collect proof while paying a price.

Part Seven writing direction:
Tension becomes legal and financial. Mira’s co-beneficiary risk appears. Keep regret slow, not instant apology.

Part Eight writing direction:
Final trap. Public event, system pause, rising panic. Do not reveal Kai fully until the correct moment.

Part Nine writing direction:
Full collapse and consequence. Use public screen, logs, debt conversion, and rejection. No cheap forgiveness.

==================================================
4. NINE-PART OVERVIEW
==================================================

PART ONE — THE DEMO THAT WAS STOLEN

Target:
Fourteen thousand to fifteen thousand five hundred characters.

Estimated scenes:
Six.

Function:
Open with Kai’s startup demo being hijacked by Damon’s new system status.

Primary payoff:
Kai notices an old beta build line in Damon’s interface.

Face-slap type:
Social humiliation with hidden proof clue.

Regret movement:
Mira arrogance.

Antagonist movement:
Damon accepts worship.

Hidden card movement:
Kai recognizes the system but stays silent.

Ending hook:
Kai sees Damon’s first reward logged as liability.

---

PART TWO — THE FIRST REWARD, THE FIRST DEBT

Target:
Twelve thousand five hundred to thirteen thousand five hundred characters.

Estimated scenes:
Five.

Function:
Show Damon’s first luxury/system flex and the first hidden debt clue.

Primary payoff:
Kai sees the reward is not free wealth.

Face-slap type:
Financial proof crack.

Regret movement:
Mira irritation because Kai does not collapse.

Antagonist movement:
Damon spends more to complete the humiliation.

Hidden card movement:
Reward liability logic is hinted.

Ending hook:
Selena notices Kai watching the system screen differently.

---

PART THREE — THE WOMAN WHO READ THE ARCHITECTURE

Target:
Twelve thousand five hundred to thirteen thousand five hundred characters.

Estimated scenes:
Five.

Function:
Introduce Selena as the recognition ally.

Primary payoff:
Selena realizes Kai understands the architecture better than Damon.

Face-slap type:
True ally recognition and technical pressure.

Regret movement:
Mira first doubt, then denial.

Antagonist movement:
Damon senses Kai is becoming dangerous.

Hidden card movement:
Selena suspects Kai understands root logic.

Ending hook:
Damon decides to claim Kai’s project as system-generated genius.

---

PART FOUR — THE STOLEN PROJECT

Target:
Thirteen thousand five hundred to fourteen thousand five hundred characters.

Estimated scenes:
Five.

Function:
Damon steals Kai’s project and presents it as a system miracle.

Primary payoff:
Damon misuses one core architecture concept, and Selena catches it.

Face-slap type:
Professional and technical crack.

Regret movement:
Mira denial.

Antagonist movement:
Damon overcompensates through bigger claims.

Hidden card movement:
Kai’s authorship is hinted through technical mismatch.

Ending hook:
The stolen project begins failing under real use.

---

PART FIVE — THE FAKE GENIUS CRACKS

Target:
Fourteen thousand to fifteen thousand five hundred characters.

Estimated scenes:
Six.

Function:
Midpoint proof that Damon can spend rewards but cannot control architecture.

Primary payoff:
Kai’s earlier warning becomes visibly correct.

Face-slap type:
Major public technical failure.

Regret movement:
Mira fear begins.

Antagonist movement:
Damon panics and blames Kai.

Hidden card movement:
System control limitation becomes clearer.

Ending hook:
Damon uses system authority to isolate Kai.

---

PART SIX — THE NPC ACCUSED OF SABOTAGE

Target:
Thirteen thousand to fourteen thousand characters.

Estimated scenes:
Five.

Function:
Enemy counterattack and protagonist cost.

Primary payoff:
Kai proves one system issue without revealing full architect identity.

Face-slap type:
Ethical and proof contrast.

Regret movement:
Mira sees Kai help despite being attacked.

Antagonist movement:
Damon escalates from flexing to manipulation.

Hidden card movement:
Admin review rule is hinted.

Ending hook:
Mira accepts co-beneficiary status to protect Damon’s image.

---

PART SEVEN — THE SIGNATURE THAT BECAME A CHAIN

Target:
Twelve thousand five hundred to thirteen thousand five hundred characters.

Estimated scenes:
Five.

Function:
Co-beneficiary risk and hidden cards align.

Primary payoff:
A warning reveals shared benefit language.

Face-slap type:
Legal and financial danger.

Regret movement:
Mira proof shock begins, but she rationalizes it.

Antagonist movement:
Damon prepares a massive public move.

Hidden card movement:
Mira’s liability connection is partially revealed.

Ending hook:
Damon announces he will buy control over a major platform.

---

PART EIGHT — THE PUBLIC CONTROL MOVE

Target:
Fourteen thousand to fifteen thousand five hundred characters.

Estimated scenes:
Six.

Function:
Final trap closes.

Primary payoff:
The system pauses and activates admin review.

Face-slap type:
Public system freeze.

Regret movement:
Mira realizes Damon does not control the system.

Antagonist movement:
Damon doubles down publicly and triggers final violation.

Hidden card movement:
All proof is ready, but Kai’s architect reveal is saved.

Ending hook:
The public screen asks for root authority confirmation.

---

PART NINE — THE ARCHITECT OPENS THE SYSTEM

Target:
Fifteen thousand to sixteen thousand five hundred characters.

Estimated scenes:
Six.

Function:
Final proof, public collapse, restored dignity.

Primary payoff:
Damon’s rewards convert into debt, and Kai is revealed as original architect.

Face-slap type:
Final systemic collapse.

Regret movement:
Mira bargains too late and is rejected.

Antagonist movement:
Damon loses chosen-one identity completely.

Hidden card movement:
All hidden cards reveal publicly.

Ending hook:
Kai leaves with authority, not with revenge begging.

==================================================
5. DETAILED PART-BY-PART MASTER PLAN
==================================================

PART ONE — THE DEMO THAT WAS STOLEN

Target character range:
Fourteen thousand to fifteen thousand five hundred.

Estimated scene count:
Six.

Drama weight:
High.

Part function:
Start with immediate public humiliation and establish the fake chosen user versus true architect dynamic.

Starting state:
Kai is preparing to present his project. Damon is newly empowered by the system. Mira is still connected to Kai but already attracted to visible success.

Main conflict:
Damon’s system-backed status hijacks Kai’s demo and turns the room against him.

Protagonist movement:
Kai appears to lose the demo and Mira, but he notices Damon’s interface contains old beta architecture.

Antagonist movement:
Damon wants to enjoy public victory and prove he is now above Kai.

Betrayer movement:
Mira chooses Damon because the room validates him.

True ally movement:
Selena may be present but not fully active yet. She notices the system screen reaction.

Proof / hidden card movement:
Kai sees the first beta build clue and first liability marker.

Visible payoff:
Viewer realizes Kai knows something Damon does not.

Face-slap design:
Social humiliation against Kai, but hidden proof gives viewer superiority.

Minor dopamine beats:
Damon’s entrance overrides Kai’s demo.
Mira physically moves to Damon’s side.
Kai sees beta build text.
First reward shows hidden liability.

Cost / consequence:
Kai loses public standing but gains proof.

Avatar slot:
Yes. Avatar One can appear after Mira chooses Damon.

Avatar topic:
Status pressure and why people mistake public validation for truth.

Must not spoil:
Do not reveal debt conversion or Kai’s full architect identity.

Writing direction:
Fast, visual, interface-heavy. Keep dialogue sharp. Do not overexplain system logic yet.

Why not repetitive:
This part uses tech-demo humiliation, not gala or luxury flex.

Ending hook:
Kai sees Damon’s first reward logged as liability.

---

PART FIVE — THE FAKE GENIUS CRACKS

Target character range:
Fourteen thousand to fifteen thousand five hundred.

Estimated scene count:
Six.

Drama weight:
High.

Part function:
Deliver midpoint proof that Damon’s status is fake because he cannot control what he stole.

Starting state:
Damon is publicly dominant. Kai is accused of jealousy. Selena is suspicious. Mira is defensive but unstable.

Main conflict:
Damon’s stolen project fails during a public test.

Protagonist movement:
Kai appears cornered but gains public proof that Damon lacks root understanding.

Antagonist movement:
Damon panics and turns failure into a sabotage accusation.

Betrayer movement:
Mira sees Damon crack for the first time but tries to explain it away.

True ally movement:
Selena becomes more active and tests the system logs.

Proof / hidden card movement:
The system control limitation becomes visible.

Visible payoff:
Kai’s earlier warning becomes correct in front of witnesses.

Face-slap design:
Technical face-slap. It attacks Damon’s false genius, not just his money.

Minor dopamine beats:
Damon misuses a command.
The system rejects his authority.
Kai predicts the failure.
Selena asks the question Damon cannot answer.

Cost / consequence:
Damon frames Kai, raising the stakes.

Avatar slot:
Yes. Avatar Two can appear after Damon blames Kai.

Avatar topic:
Ego protection and why exposed frauds often attack the person who saw the truth first.

Must not spoil:
Do not reveal final admin review.

Writing direction:
High tension, public pressure, controlled dialogue. Let the failed system behavior carry the proof.

Why not repetitive:
This is not another humiliation scene. It is a competence test.

Ending hook:
Damon uses system authority to isolate Kai.

---

PART NINE — THE ARCHITECT OPENS THE SYSTEM

Target character range:
Fifteen thousand to sixteen thousand five hundred.

Estimated scene count:
Six.

Drama weight:
High.

Part function:
Resolve every hidden card through public proof and irreversible consequence.

Starting state:
Damon has triggered admin review. Mira is panicking. Selena is ready to validate proof. Kai must reveal root authority.

Main conflict:
Damon tries to deny the system review while the public screen exposes his liabilities.

Protagonist movement:
Kai stops hiding and confirms root authority.

Antagonist movement:
Damon loses control, blames the system, and breaks publicly.

Betrayer movement:
Mira tries to separate herself from Damon’s debt chain and asks Kai for another chance.

True ally movement:
Selena validates Kai’s architecture and makes the proof credible.

Proof / hidden card movement:
All hidden cards reveal: beta architect, liabilities, co-beneficiary link, protocol violation.

Visible payoff:
Damon’s rewards convert into debt and Kai is publicly recognized.

Face-slap design:
Final systemic collapse. The system itself destroys Damon’s false identity.

Minor dopamine beats:
Admin review confirms violation.
Reward list converts to debt.
Mira’s co-beneficiary status appears.
Kai’s root authority appears.
Selena confirms his authorship.

Cost / consequence:
Damon loses status. Mira loses the future she chose. Kai rejects cheap forgiveness.

Avatar slot:
Yes. Avatar Three can appear before or during the final proof reveal.

Avatar topic:
The difference between borrowed status and earned authority.

Must not spoil:
This is the finale, so hidden cards can now resolve.

Writing direction:
Public, clean, visual. Use screens, logs, and reactions. Avoid long speeches.

Why not repetitive:
This is the only full systemic reveal and irreversible collapse.

Ending hook:
Kai leaves with authority and no need to beg for old validation.

Note:
Parts Two, Three, Four, Six, Seven, and Eight must be expanded in the real output using the same format.

==================================================
6. FACE-SLAP RHYTHM MAP
==================================================

Part One:
Major humiliation plus hidden clue.
Type: social with viewer superiority.

Part Two:
First debt clue.
Type: financial proof crack.

Part Three:
Selena recognizes Kai.
Type: social and intellectual reversal.

Part Four:
Damon’s stolen project shows mismatch.
Type: professional and technical crack.

Part Five:
Public system failure.
Type: major technical face-slap.

Part Six:
Damon’s accusation creates more proof.
Type: ethical and strategic contrast.

Part Seven:
Co-beneficiary warning appears.
Type: legal and financial danger.

Part Eight:
System freezes during public control move.
Type: public proof panic.

Part Nine:
Rewards convert into debt.
Type: final systemic collapse.

==================================================
7. AVATAR PLACEMENT PLAN
==================================================

Avatar One:
Recommended part:
Part One.

Recommended moment:
After Mira’s betrayal in Part One.

Topic:
Status pressure.

Lesson:
People often mistake the person approved by the room for the person who is actually right.

Must not spoil:
Do not reveal that rewards become debt.

Avatar Two:
Recommended part:
Part Five.

Recommended moment:
After Damon’s ego panic in Part Five.

Topic:
Ego defense.

Lesson:
When a fake identity is threatened, the fraud often attacks the witness instead of solving the problem.

Must not spoil:
Do not reveal final admin review.

Avatar Three:
Recommended part:
Part Nine.

Recommended moment:
When rewards convert into debt.

Topic:
Borrowed status versus earned authority.

Lesson:
Power borrowed from a system disappears when the rules turn against the user, but authority built on authorship remains.

Must not spoil:
Finale reveal is allowed here.

==================================================
8. PUBLIC PAYOFF MAP
==================================================

Part One:
Payoff type: hidden proof clue.
Witnesses: viewer and Kai.
False belief cracked: Damon is truly chosen.
Status gain: Damon publicly.
Status loss: Kai publicly.
New problem: Kai lacks public proof.

Part Two:
Payoff type: financial proof crack.
Witnesses: viewer and Kai.
False belief cracked: rewards are free money.
New problem: liabilities grow.

Part Three:
Payoff type: true ally recognition.
Witnesses: Selena and limited crowd.
False belief cracked: Kai is an NPC.
New problem: Damon feels threatened.

Part Five:
Payoff type: public technical failure.
Witnesses: investors and crowd.
False belief cracked: system status equals competence.
New problem: Damon frames Kai.

Part Nine:
Payoff type: final systemic collapse.
Witnesses: public arena.
False belief cracked: Damon is chosen billionaire.
New problem: aftermath and consequence.

==================================================
9. BETRAYER REGRET MAP
==================================================

Part One:
Arrogance. Mira believes Damon is chosen.

Part Two:
Irritation. Kai does not beg.

Part Three:
Doubt. Selena treats Kai seriously.

Part Four:
Denial. Mira defends Damon’s technical weakness.

Part Five:
Fear. Damon’s stolen project fails.

Part Six:
Moral discomfort. Kai helps despite being framed.

Part Seven:
Proof shock. Shared liability language appears.

Part Eight:
Panic. Damon cannot control the system.

Part Nine:
Bargaining and rejection. Mira asks too late.

==================================================
10. ANTAGONIST ESCALATION MAP
==================================================

Part One:
Damon hijacks Kai’s demo.

Part Two:
Damon flexes rewards to complete humiliation.

Part Three:
Damon dodges technical questions.

Part Four:
Damon claims Kai’s project.

Part Five:
Damon fails publicly and blames Kai.

Part Six:
Damon uses system status to isolate Kai.

Part Seven:
Damon prepares a massive acquisition.

Part Eight:
Damon triggers admin review through public abuse.

Part Nine:
Damon collapses under proof.

==================================================
11. PROTAGONIST CONTROL MAP
==================================================

Part One:
Kai loses public status but gains beta-system proof.

Part Two:
Kai loses social ground but gains liability evidence.

Part Three:
Kai gains Selena’s attention.

Part Four:
Kai loses project credit but gains proof Damon does not understand it.

Part Five:
Kai gains public failure proof.

Part Six:
Kai gains evidence of Damon’s abuse.

Part Seven:
Kai gains co-beneficiary proof.

Part Eight:
Kai gains final protocol violation.

Part Nine:
Kai reveals root authority.

==================================================
12. HIDDEN CARD MAP
==================================================

Hidden Card One:
Kai created the beta system.
Hinted: Part One.
Partial reveal: Part Three.
Viewer understands: Part Five.
Public reveal: Part Nine.

Hidden Card Two:
Rewards are liabilities.
Hinted: Part Two.
Partial reveal: Part Seven.
Viewer understands: Part Seven.
Public reveal: Part Nine.

Hidden Card Three:
Mira is linked through co-beneficiary status.
Hinted: Part Six.
Partial reveal: Part Seven.
Viewer understands: Part Eight.
Public reveal: Part Nine.

Hidden Card Four:
Damon must violate protocol before review.
Hinted: Kai’s restraint.
Partial reveal: Part Six.
Viewer understands: Part Eight.
Public reveal: Part Nine.

==================================================
13. SCENE CARD REQUIREMENTS FOR STAGE 03
==================================================

Approximate total scene count:
Forty nine scenes.

Recommended scene count:
Part One: six.
Part Two: five.
Part Three: five.
Part Four: five.
Part Five: six.
Part Six: five.
Part Seven: five.
Part Eight: six.
Part Nine: six.

Each scene card must include:
Scene title, part, estimated length, surface, characters, purpose, conflict, action, proof or hidden card, visible payoff, status shift, regret or panic, protagonist control, exit hook, repetition risk.

Parts needing most detail:
Parts One, Five, Eight, and Nine.

Parts to keep tighter:
Parts Two, Three, Four, Six, and Seven.

==================================================
14. SCENE SURFACE GUIDANCE FOR STAGE 03
==================================================

Use:
Startup pitch room, demo stage, investor lounge, access-control gate, system dashboard, code review room, public launch, platform acquisition event, admin review screen.

Avoid:
Gala, red carpet, helicopter, luxury-store card decline, generic billionaire party, generic boardroom collapse.

Risk:
Too many screen reveals.

Prevention:
Mix interface proof with social pressure, investor reactions, access failures, signatures, and live system behavior.

Opening to protect:
Startup Demo Hijack.

==================================================
15. PACING RISK CHECK
==================================================

Risk:
Too many money flexes.

Correction:
Every flex must create proof or consequence.

Risk:
Mira regrets too early.

Correction:
Keep her defensive until after midpoint.

Risk:
Damon becomes stupid.

Correction:
Make him socially clever but technically shallow.

Risk:
Kai too passive.

Correction:
Show him collecting proof and predicting failures.

Risk:
Avatar placement random.

Correction:
Tie avatars to betrayal, ego panic, and final authority lesson.

Risk:
Final reveal sudden.

Correction:
Seed beta system, liability layer, co-beneficiary status, and protocol rule early.

==================================================
16. STAGE 02 FINAL DECISION
==================================================

A. APPROVED FOR 03 SCENE CARDS.

Reason:
The plan defines length, scene density, face-slap rhythm, avatar placement, hidden card timing, regret movement, antagonist escalation, and writing direction.

==================================================
17. HANDOFF TO 03 SCENE CARDS
==================================================

Nine-part summary:
Part One: demo hijack.
Part Two: first reward and hidden debt.
Part Three: Selena recognizes Kai.
Part Four: stolen project.
Part Five: fake genius cracks.
Part Six: sabotage accusation.
Part Seven: co-beneficiary liability.
Part Eight: public control move.
Part Nine: admin review and architect reveal.

Target character counts:
Part One: fourteen thousand to fifteen thousand five hundred.
Part Two: twelve thousand five hundred to thirteen thousand five hundred.
Part Three: twelve thousand five hundred to thirteen thousand five hundred.
Part Four: thirteen thousand five hundred to fourteen thousand five hundred.
Part Five: fourteen thousand to fifteen thousand five hundred.
Part Six: thirteen thousand to fourteen thousand.
Part Seven: twelve thousand five hundred to thirteen thousand five hundred.
Part Eight: fourteen thousand to fifteen thousand five hundred.
Part Nine: fifteen thousand to sixteen thousand five hundred.

Scene counts:
Six, five, five, five, six, five, five, six, six.

Face-slap rhythm:
Social, financial, recognition, technical, midpoint public failure, ethical contrast, legal liability, public system freeze, final systemic collapse.

Avatar placement:
Avatar One after Mira’s betrayal in Part One.
Avatar Two after Damon’s ego panic in Part Five.
Avatar Three during final authority lesson in Part Nine.

Final script contract:
One hundred twenty thousand to one hundred thirty thousand characters.
Paragraphs one hundred twenty to two hundred twenty characters.
Numbers written as words.
Exactly three avatar lines if enabled.

Main risk for Stage 03:
Do not create repeated scenes where Damon only flexes money and Kai silently watches.

Key rule for scene cards:
Every scene must move proof, regret, antagonist escalation, protagonist control, payoff, or hidden card timing forward.`}
                  </div>
                )}
              </div>
            )}

            {state.activeStageIdx === 3 && (
              <div className="border border-white/5 bg-[#0F1115]/85 rounded-lg p-3.5 font-sans text-xs flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowStage03Help(!showStage03Help)}
                  className="flex items-center justify-between text-blue-400 hover:text-blue-300 font-mono tracking-wider font-bold text-[11px] focus:outline-none w-full text-left"
                >
                  <span className="flex items-center gap-1.5 uppercase">
                    💡 Stage 03 (Scene Cards) Planning Guidelines
                  </span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{showStage03Help ? "COLLAPSE ▲" : "EXPAND ▼"}</span>
                </button>
                {showStage03Help && (
                  <div className="mt-3 text-slate-400 bg-black/60 border border-white/5 p-4 rounded-lg font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text selection:bg-blue-500/30">
                    <div className="text-white font-bold mb-3 border-b border-white/10 pb-1 uppercase tracking-wider text-[11px] text-blue-300">
                      COMPACT EXAMPLE 03 SCENE CARDS
                    </div>
{`Project:
System Billionaire / Admin System Revenge

Note:
This is a compact example. In a real Stage 03 output, all planned scenes for all nine parts must be expanded. This example shows the correct format and logic without becoming too huge.

==================================================
1. STAGE 02 HANDOFF RECAP
==================================================

Nine-part summary:
Part One: Kai’s startup demo is hijacked by Damon’s new Billionaire System status.
Part Two: Damon’s first reward creates the first hidden debt clue.
Part Three: Selena recognizes Kai’s real system knowledge.
Part Four: Damon steals Kai’s project.
Part Five: Damon’s fake genius cracks during a public test.
Part Six: Damon accuses Kai of sabotage.
Part Seven: Mira’s co-beneficiary status becomes dangerous.
Part Eight: Damon attempts a massive public control move.
Part Nine: Admin review reveals Kai as the architect and converts rewards into debt.

Target character count:
One hundred twenty thousand to one hundred thirty thousand characters total.

Scene count plan:
Forty nine scenes total.

Avatar placement:
Avatar One in Part One after Mira chooses Damon.
Avatar Two in Part Five after Damon blames Kai.
Avatar Three in Part Nine during the final authority lesson.

Key rule:
Every scene must move proof, regret, antagonist escalation, protagonist control, payoff, or hidden card timing forward.

==================================================
2. TOTAL SCENE STRATEGY
==================================================

Part One:
Target: fourteen thousand to fifteen thousand five hundred characters.
Scenes: six.
Reason: strong hook, public humiliation, first betrayal, first hidden clue.

Part Two:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Scenes: five.
Reason: first reward, first hidden debt, first consequence.

Part Three:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Scenes: five.
Reason: Selena recognition and system logic testing.

Part Four:
Target: thirteen thousand five hundred to fourteen thousand five hundred characters.
Scenes: five.
Reason: project theft and technical mismatch.

Part Five:
Target: fourteen thousand to fifteen thousand five hundred characters.
Scenes: six.
Reason: midpoint public failure and major face-slap.

Part Six:
Target: thirteen thousand to fourteen thousand characters.
Scenes: five.
Reason: counterattack, accusation, protagonist cost.

Part Seven:
Target: twelve thousand five hundred to thirteen thousand five hundred characters.
Scenes: five.
Reason: liability chain and hidden card alignment.

Part Eight:
Target: fourteen thousand to fifteen thousand five hundred characters.
Scenes: six.
Reason: final trap and public system freeze.

Part Nine:
Target: fifteen thousand to sixteen thousand five hundred characters.
Scenes: six.
Reason: final reveal, debt conversion, consequences, rejection.

==================================================
3. OPENING SURFACE ORIGINALITY CHECK
==================================================

Approved opening surface:
Startup demo room / investor pitch floor.

First visual image:
Kai’s demo screen freezes as Damon’s Billionaire System interface overrides the projection.

Witness group:
Investors, startup founders, Mira, Damon, tech staff, Selena watching from the investor row.

Humiliation method:
Kai loses the room before he can present his own project.

Betrayer action:
Mira leaves Kai’s side and stands beside Damon when the crowd begins treating Damon as the chosen founder.

First proof clue:
Kai sees an old beta build line hidden inside Damon’s system interface.

First hidden card hint:
The system is connected to Kai’s old architecture.

Similarity risk:
Low.

Why it is not generic:
The opening comes from tech, system interface, startup status, and public validation. It is not a gala, red carpet, helicopter, or luxury party opening.

Decision:
PASSED — SCENE CARDS CAN CONTINUE.

==================================================
4. SCENE SURFACE DIVERSITY PLAN
==================================================

Startup demo floor:
Appears in Part One.
Function: public humiliation, system reveal, first betrayal.

Investor lounge:
Appears in Parts Two and Three.
Function: status pressure, Selena’s first observations, social hierarchy.

System dashboard / interface screen:
Appears across Parts One, Two, Five, Eight, and Nine.
Function: visual proof, hidden cards, final reveal.
Risk: too many screen-only scenes.
Prevention: pair screens with public reactions, access failures, signatures, or live system behavior.

Code review room:
Appears in Parts Three and Four.
Function: true competence test.

Public product launch:
Appears in Part Five.
Function: midpoint failure.

Compliance / contract station:
Appears in Part Seven.
Function: co-beneficiary signature and liability clue.

Platform acquisition event:
Appears in Part Eight.
Function: final trap.

Admin review screen:
Appears in Part Nine.
Function: final systemic collapse.

Surfaces to avoid:
Gala, red carpet, helicopter entrance, luxury-store card decline, generic billionaire party, generic boardroom collapse.

==================================================
5. COMPLETE SCENE CARDS BY PART
==================================================

==================================================
PART ONE — THE DEMO THAT WAS STOLEN
Target character range:
Fourteen thousand to fifteen thousand five hundred characters.

Planned scene count:
Six.

Part function:
Open with public humiliation, wrong choice, and the first proof that Kai understands Damon’s system.

Part-level face-slap:
Social humiliation with hidden proof clue.

Part-level hidden card movement:
Kai recognizes beta architecture inside Damon’s system.

Part-level regret movement:
Mira begins in arrogance.

Part-level antagonist movement:
Damon accepts chosen-one worship.

Part-level protagonist control:
Kai appears to lose the room but secretly gains first proof.

Avatar slot:
Avatar One.

Part ending hook:
Kai sees Damon’s first reward logged as a hidden liability.
==================================================

SCENE ONE.ONE — THE SCREEN THAT CHOSE DAMON

Part:
Part One.

Estimated final script length:
Two thousand to two thousand five hundred characters.

Surface:
Startup demo room.

Characters:
Kai, Damon, Mira, investors, Selena, startup crowd.

Purpose:
Start with a public tech humiliation instead of a generic luxury scene.

Conflict:
Kai is about to present his project, but Damon’s Billionaire System hijacks the screen and steals the room’s attention.

Action:
Kai’s project demo freezes. Damon enters with a system-generated founder profile, instant funding badge, and public credibility.

Proof / Hidden Card:
Kai notices a beta build line that resembles his old system architecture.

Visible Payoff:
Viewer sees Kai recognize something everyone else misses.

Status Shift:
Damon gains public status. Kai loses the room. Kai secretly gains proof.

Regret / Panic:
Mira feels validated by Damon’s sudden status and begins emotionally moving away from Kai.

Protagonist Control:
Kai does not expose himself yet. He watches the interface instead of arguing.

True Ally Function:
Selena observes Kai’s reaction but does not intervene yet.

Avatar Use:
No avatar.

Exit Hook:
Damon invites Mira to stand with him during the system announcement.

Repetition Risk:
Could feel like generic public humiliation.
Prevention: keep the humiliation tied to system interface and startup proof.

---

SCENE ONE.TWO — MIRA MOVES TO THE WINNER

Part:
Part One.

Estimated final script length:
Two thousand to two thousand four hundred characters.

Surface:
Startup demo floor / investor seating area.

Characters:
Kai, Mira, Damon, investors, Selena.

Purpose:
Lock the betrayal through public status choice.

Conflict:
Mira must choose whether to stay beside Kai or move toward Damon’s visible system success.

Action:
Damon calls Kai an NPC in front of the room. Mira does not defend Kai. She steps beside Damon when investors applaud.

Proof / Hidden Card:
Kai sees Damon’s system interface process the social reward as a user benefit.

Visible Payoff:
The viewer feels betrayal and wants Damon and Mira punished later.

Status Shift:
Damon gains romantic and social dominance. Kai loses public dignity.

Regret / Panic:
Mira is arrogant, not regretful. She thinks she chose the future.

Protagonist Control:
Kai absorbs the humiliation and watches what the system records.

True Ally Function:
Selena notices that Kai is watching the logs, not Mira.

Avatar Use:
Avatar One.

Avatar topic:
Status pressure and why people mistake public validation for truth.

Avatar lesson:
The avatar should explain that Mira is not choosing truth; she is choosing the person the room has approved. It must not reveal debt conversion.

Exit Hook:
Kai sees the word benefit change into conditional benefit in the hidden system layer.

Repetition Risk:
Could become generic girlfriend betrayal.
Prevention: make the betrayal happen through public system status and interface proof.

---

SCENE ONE.THREE — THE FIRST LIABILITY MARKER

Part:
Part One.

Estimated final script length:
Two thousand to two thousand five hundred characters.

Surface:
Back of the demo room / side projection terminal.

Characters:
Kai, Damon, Mira, Selena nearby.

Purpose:
Plant the reward-to-debt mechanic.

Conflict:
Damon celebrates his first system reward while Kai sees the backend warning.

Action:
Damon receives a luxury founder package from the system. The crowd sees wealth. Kai sees a hidden liability marker behind the reward.

Proof / Hidden Card:
Hidden Card Two is hinted: rewards are liabilities, not gifts.

Visible Payoff:
Viewer gets superiority. Damon thinks he is rising, but Kai knows the rise has a cost.

Status Shift:
Damon appears to gain status. Secretly, he creates debt evidence.

Regret / Panic:
Mira is proud of Damon’s reward and does not notice the warning.

Protagonist Control:
Kai secretly understands the first rule of Damon’s downfall.

True Ally Function:
Selena sees Kai react before the reward animation finishes.

Avatar Use:
No avatar.

Exit Hook:
Selena asks Kai why he looked at the backend line instead of the reward.

Repetition Risk:
Could become screen-only proof.
Prevention: pair the screen clue with Selena noticing Kai’s behavior.

==================================================
PART TWO — THE FIRST REWARD, THE FIRST DEBT
Target character range:
Twelve thousand five hundred to thirteen thousand five hundred characters.

Planned scene count:
Five.

Part function:
Show Damon’s first public flex while Kai identifies the hidden debt structure.

Part-level face-slap:
Financial proof crack.

Part-level hidden card movement:
Reward liability logic becomes clearer.

Part ending hook:
Selena begins tracking Kai’s system knowledge.
==================================================

SCENE TWO.ONE — THE REWARD THAT LOOKED LIKE A GIFT

Part:
Part Two.

Estimated final script length:
Two thousand to two thousand four hundred characters.

Surface:
Investor lounge.

Characters:
Kai, Damon, Mira, Selena, investors.

Purpose:
Show Damon using rewards as social domination.

Conflict:
Damon uses the system to embarrass Kai in front of investors, but Kai notices the reward terms are conditional.

Action:
Damon receives premium investor access and uses it to push Kai out of the conversation.

Proof / Hidden Card:
The reward contains a hidden repayment condition.

Visible Payoff:
Viewer sees Damon’s flex become future evidence.

Status Shift:
Damon gains access. Kai loses public position but gains proof.

Regret / Panic:
Mira is irritated that Kai does not react emotionally.

Protagonist Control:
Kai records the wording without revealing he understands it.

True Ally Function:
Selena notices Kai reading terms instead of reacting to insults.

Avatar Use:
No avatar.

Exit Hook:
Selena privately asks who taught Kai to read system contracts.

Repetition Risk:
Could become another humiliation beat.
Prevention: make the real payoff the hidden contract condition.

==================================================
PART THREE — THE WOMAN WHO READ THE ARCHITECTURE
Target character range:
Twelve thousand five hundred to thirteen thousand five hundred characters.

Planned scene count:
Five.

Part function:
Introduce Selena as true ally and test Kai’s knowledge.

Part-level face-slap:
True ally recognition and technical pressure.

Part ending hook:
Damon decides to steal Kai’s project.
==================================================

SCENE THREE.ONE — SELENA’S TEST

Part:
Part Three.

Estimated final script length:
Two thousand three hundred to two thousand seven hundred characters.

Surface:
Code review room.

Characters:
Kai, Selena, Damon, Mira.

Purpose:
Create the first serious recognition of Kai’s hidden value.

Conflict:
Selena asks Damon a system architecture question, then watches Kai answer the logic without trying to show off.

Action:
Damon gives a vague answer. Kai corrects one assumption indirectly. Selena realizes Kai understands the system beneath the interface.

Proof / Hidden Card:
Hidden Card One is partially revealed to Selena.

Visible Payoff:
Kai gains private credibility.

Status Shift:
Damon loses intellectual authority in Selena’s eyes.

Regret / Panic:
Mira feels doubt but rationalizes Selena’s interest as curiosity.

Protagonist Control:
Kai gives only enough information to survive the test.

True Ally Function:
Selena begins acting as recognition ally.

Avatar Use:
No avatar.

Exit Hook:
Damon decides Kai’s project must be taken before Selena looks deeper.

==================================================
PART FIVE — THE FAKE GENIUS CRACKS
Target character range:
Fourteen thousand to fifteen thousand five hundred characters.

Planned scene count:
Six.

Part function:
Deliver midpoint public proof that Damon cannot control what he stole.

Part-level face-slap:
Major public technical failure.

Avatar slot:
Avatar Two.

Part ending hook:
Damon accuses Kai of sabotage.
==================================================

SCENE FIVE.THREE — THE COMMAND THAT FAILED

Part:
Part Five.

Estimated final script length:
Two thousand four hundred to two thousand eight hundred characters.

Surface:
Public product launch stage.

Characters:
Damon, Kai, Mira, Selena, investors, tech crowd.

Purpose:
Make Damon’s fake genius crack publicly.

Conflict:
Damon tries to run Kai’s stolen project under system authority, but the architecture rejects his command.

Action:
Damon enters the command confidently. The system delays, rejects his access, and exposes that he lacks root understanding.

Proof / Hidden Card:
The system control limitation becomes visible.

Visible Payoff:
Major technical face-slap. Damon’s genius image cracks in front of witnesses.

Status Shift:
Damon loses authority. Kai’s earlier warning gains weight.

Regret / Panic:
Damon panics. Mira feels fear but still avoids admitting Kai was right.

Protagonist Control:
Kai gains public proof without revealing full architect identity.

True Ally Function:
Selena asks the one question Damon cannot answer.

Avatar Use:
Avatar Two.

Avatar topic:
Ego defense after exposure.

Avatar lesson:
The avatar should explain why exposed frauds often attack the person who saw the truth first. It must not spoil final admin review.

Exit Hook:
Damon claims Kai sabotaged the system.

Repetition Risk:
Could become only a screen failure.
Prevention: show public reaction, Damon’s forced confidence, and Selena’s precise question.

==================================================
PART NINE — THE ARCHITECT OPENS THE SYSTEM
Target character range:
Fifteen thousand to sixteen thousand five hundred characters.

Planned scene count:
Six.

Part function:
Reveal all hidden cards, collapse Damon, reject cheap forgiveness, restore Kai’s authority.

Part-level face-slap:
Final systemic collapse.

Avatar slot:
Avatar Three.

Part ending hook:
Kai leaves with real authority.
==================================================

SCENE NINE.TWO — REWARDS CONVERTED INTO DEBT

Part:
Part Nine.

Estimated final script length:
Two thousand six hundred to three thousand characters.

Surface:
Public admin review screen.

Characters:
Kai, Damon, Mira, Selena, investors, public witnesses.

Purpose:
Deliver the final systemic face-slap.

Conflict:
Damon tries to deny the admin review while the system displays his violations.

Action:
The public screen lists Damon’s rewards, then converts them into liabilities after confirming protocol abuse.

Proof / Hidden Card:
Hidden Card Two becomes public. Damon’s rewards were liabilities.

Visible Payoff:
Damon’s billionaire identity collapses in front of everyone.

Status Shift:
Damon loses chosen-one status. Kai’s authority rises.

Regret / Panic:
Damon breaks. Mira realizes the future she chose was debt.

Protagonist Control:
Kai allows the system proof to speak before revealing root authority.

True Ally Function:
Selena confirms the review is legitimate.

Avatar Use:
Avatar Three.

Avatar topic:
Borrowed status versus earned authority.

Avatar lesson:
The avatar should explain that power borrowed from a system disappears when rules turn against the user, but authority built through authorship remains.

Exit Hook:
The system asks for root authority confirmation.

Repetition Risk:
Could become a long explanation.
Prevention: use public screen, reward list, debt conversion, and reactions instead of a speech.

==================================================
6. FACE-SLAP DISTRIBUTION CHECK
==================================================

Part One:
Scene One.Two.
Type: social.
Size: major opening humiliation.
False belief attacked: Kai is worthless.
Risk: generic betrayal.
Correction: tie it to system interface and beta clue.

Part Two:
Scene Two.One.
Type: financial.
Size: medium.
False belief attacked: rewards are free wealth.
Risk: simple flex.
Correction: reward must create liability proof.

Part Three:
Scene Three.One.
Type: recognition.
Size: medium.
False belief attacked: Kai is an NPC.
Risk: too private.
Correction: make Selena’s test create social pressure.

Part Five:
Scene Five.Three.
Type: technical.
Size: major midpoint.
False belief attacked: Damon is a system genius.
Risk: screen-only proof.
Correction: add public witnesses and Selena’s question.

Part Nine:
Scene Nine.Two.
Type: final systemic.
Size: final.
False belief attacked: Damon is chosen.
Risk: monologue reveal.
Correction: let system proof carry the scene.

==================================================
7. AVATAR SLOT CHECK
==================================================

Avatar One:
Part: Part One.
Scene: Scene One.Two.
Topic: status pressure.
Lesson: people often choose the person approved by the room, even when truth is visible.
Must not spoil: reward-to-debt conversion.

Avatar Two:
Part: Part Five.
Scene: Scene Five.Three.
Topic: ego defense.
Lesson: when fake identity is exposed, the fraud often attacks the witness.
Must not spoil: final admin review.

Avatar Three:
Part: Part Nine.
Scene: Scene Nine.Two.
Topic: borrowed status versus earned authority.
Lesson: borrowed power collapses when rules turn against the user; authorship remains.
Must not spoil: finale reveal is allowed here.

Avatar count:
Exactly three.

Status:
Passed.

==================================================
8. HIDDEN CARD TIMING CHECK
==================================================

Hidden Card One:
Kai created the beta system.
Hint scenes: One.One, Three.One.
Partial reveal: Three.One.
Viewer understanding: Five.Three.
Public reveal: Nine.Three.
Must not reveal before: Part Nine.

Hidden Card Two:
Rewards are liabilities.
Hint scenes: One.Three, Two.One.
Partial reveal: Seven.One.
Viewer understanding: Seven.
Public reveal: Nine.Two.
Must not reveal before: final admin review.

Hidden Card Three:
Mira’s co-beneficiary status links her to Damon’s debt.
Hint scenes: Six.Five.
Partial reveal: Seven.Two.
Viewer understanding: Eight.
Public reveal: Nine.Four.
Must not reveal before: Part Nine.

Hidden Card Four:
Damon must violate protocol before review.
Hint scenes: Kai’s restraint across early parts.
Partial reveal: Six.
Viewer understanding: Eight.
Public reveal: Nine.
Must not reveal before: Part Eight.

Status:
Passed.

==================================================
9. REGRET AND PANIC TRACK
==================================================

Part One:
Mira arrogance. Damon confidence.

Part Two:
Mira irritation. Damon enjoys social victory.

Part Three:
Mira doubt. Damon feels threatened.

Part Four:
Mira denial. Damon overcompensates.

Part Five:
Mira fear. Damon panics and blames Kai.

Part Six:
Mira moral discomfort. Damon manipulates authority.

Part Seven:
Mira proof shock. Damon prepares bigger gamble.

Part Eight:
Mira panic. Damon doubles down.

Part Nine:
Mira bargains too late. Damon collapses.

Status:
Passed.

==================================================
10. PROTAGONIST CONTROL TRACK
==================================================

Part One:
Kai loses the demo but gains beta proof.

Part Two:
Kai loses social ground but gains liability proof.

Part Three:
Kai gains Selena’s attention.

Part Four:
Kai loses project credit but gains technical mismatch proof.

Part Five:
Kai gains public failure proof.

Part Six:
Kai gains evidence of Damon’s abuse.

Part Seven:
Kai gains co-beneficiary liability proof.

Part Eight:
Kai gains final protocol violation.

Part Nine:
Kai reveals root authority.

Status:
Passed.

==================================================
11. DIALOGUE AND EXPOSITION CONTROL
==================================================

Risky scene:
Scene Three.One.

Risk:
Selena’s test could become a long technical lecture.

Fix:
Use one precise question, one failed Damon answer, and one short Kai correction.

Risky scene:
Scene Nine.Two.

Risk:
Final proof could become a monologue.

Fix:
Use public screen, debt conversion list, root authority prompt, and short Selena validation.

Risky scene:
Scene Seven.Two.

Risk:
Co-beneficiary explanation could become too legalistic.

Fix:
Show Mira’s signature, shared benefit line, and system warning instead of contract lecture.

==================================================
12. FINAL SCRIPT READINESS CHECK
==================================================

All nine parts covered:
Yes.
Planned scene count: forty nine scenes.
Visible payoff in every part: yes.
Face-slaps varied: yes.
Avatar slots exactly three: yes.
Hidden cards timed correctly: yes.
Regret gradual: yes.
Antagonist escalation logical: yes.
Protagonist control believable: yes.
Scene surfaces premise-specific: yes.
Supports 120,000 to 130,000 characters: yes.
`}
                  </div>
                )}
              </div>
            )}

            {/* Stage actions controls */}
            <div className="flex flex-col gap-4 pt-1 bg-white/5 p-5 rounded-lg border border-white/10">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-tighter flex items-center gap-1.5">
                  <MessageSquare className="w-3 h-3" /> Stage {activeStageConfig.code} Feedback & Corrections
                </label>
                <textarea
                  value={activeStageData.feedback || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const activeKey = activeStageConfig.key;
                    setState(prev => {
                      const nextStages = { ...prev.stages };
                      nextStages[activeKey] = { ...nextStages[activeKey], feedback: val };
                      return { ...prev, stages: nextStages };
                    });
                  }}
                  placeholder={`Optional corrections for Stage ${activeStageConfig.code}... AI will use this feedback to rewrite the output.`}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs font-mono text-blue-200 focus:outline-none focus:border-blue-500/20 min-h-[50px] max-h-[100px]"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex gap-2">
                  {state.activeStageIdx < 4 && (
                    <button
                      onClick={() => handleGenerateStage(activeStageData.feedback)}
                      disabled={isGenerating || (state.activeStageIdx === 0 && !state.rawIdea.trim())}
                      className="py-2 px-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white uppercase tracking-wider rounded flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/20 active:translate-y-[1px] focus:outline-none"
                    >
                      {isGenerating ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-blue-100" />
                      )}
                      {activeStageData.feedback ? `Rewrite Stage ${activeStageConfig.code}` : `Generate Stage ${activeStageConfig.code}`}
                    </button>
                  )}

                  {state.activeStageIdx === 5 && (
                    <button
                      onClick={handleRunLinter}
                      disabled={isGenerating}
                      className="py-2 px-5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white uppercase tracking-wider rounded flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-fuchsia-600/20 active:translate-y-[1px] focus:outline-none"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-fuchsia-100" />}
                      Run Stage 05 Linter QA
                    </button>
                  )}

                  {state.activeStageIdx === 6 && (
                    <button
                      onClick={handleRunVoiceoverCleaner}
                      disabled={isGenerating}
                      className="py-2 px-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white uppercase tracking-wider rounded flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/20 active:translate-y-[1px] focus:outline-none"
                    >
                      {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-blue-100" />}
                      Run Stage 06 Voiceover Cleaner
                    </button>
                  )}

                {activeStageData.status === "draft" && (
                  <button
                    onClick={handleApproveStage}
                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white uppercase tracking-wider rounded flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-600/20 focus:outline-none"
                    title="Validate and freeze Stage output"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-100" /> Approve Draft
                  </button>
                )}

                {activeStageData.status === "approved" && (
                  <button
                    onClick={handleUnlockStage}
                    className="py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-200 uppercase tracking-wider rounded flex items-center gap-1.5 transition-all focus:outline-none"
                    title="Unlock Stage to enable editing or regeneration"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-blue-400" /> Unlock & Modify
                  </button>
                )}
              </div>

              <div className="flex gap-2 text-xs font-mono">
                {activeStageData.handoff && (
                  <button
                    onClick={handleCopyHandoff}
                    className="py-2 px-3 bg-[#13151A] hover:bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded flex items-center gap-1.5 transition-all focus:outline-none"
                  >
                    <Clipboard className="w-3.5 h-3.5 text-slate-500" /> Copy Handoff details
                  </button>
                )}
                
                {state.activeStageIdx < 6 && (
                  <button
                    onClick={() => setState(prev => ({ ...prev, activeStageIdx: prev.activeStageIdx + 1 }))}
                    className="py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/5 text-slate-400 hover:text-white rounded flex items-center gap-1 transition-all focus:outline-none h-full"
                  >
                    Next Stage <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

          {/* Stage 04 Specific Sub-Workspace: Nine parts script editor */}
          {state.activeStageIdx === 4 && (
            <section className="bg-[#13151A] border border-white/10 rounded-lg p-5 shadow-2xl flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-1">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Stage 04: Nine-Part Multiwriter
                  </h3>
                  <p className="text-xs text-slate-500">Draft your 120k+ character script part by part from standard approved scene matrices.</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono text-slate-400">Total drafted characters:</span>
                  <div className={`text-md font-bold font-mono ${calculateTotalScriptChars() >= 120000 ? "text-emerald-400" : "text-blue-400 animate-pulse"}`}>
                    {calculateTotalScriptChars().toLocaleString()} / 120,000 chars
                  </div>
                </div>
              </div>

              {/* Guidelines collapsible */}
              <div className="border border-white/5 bg-[#0F1115]/85 rounded-lg p-3.5 font-sans text-xs flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setShowStage04Help(!showStage04Help)}
                  className="flex items-center justify-between text-blue-400 hover:text-blue-300 font-mono tracking-wider font-bold text-[11px] focus:outline-none w-full text-left"
                >
                  <span className="flex items-center gap-1.5 uppercase w-full">
                    💡 Stage 04 (Final Script) Writing Guidelines
                  </span>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                    {showStage04Help ? "COLLAPSE ▲" : "EXPAND ▼"}
                  </span>
                </button>
                {showStage04Help && (
                  <div className="mt-2 text-slate-400 bg-black/60 border border-white/5 p-4 rounded-lg font-mono text-[11px] leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text selection:bg-blue-500/30">
                    <div className="text-white font-bold mb-3 border-b border-white/10 pb-1 uppercase tracking-wider text-[11px] text-blue-300">
                      Compact Example Response for Stage 04
                    </div>
{`==================================================
IMPORTANT: HOW TO USE THIS EXAMPLE
==================================================

This is only an example of Stage 04 FINAL SCRIPT output.

Do not copy this plot, wording, scene order, character actions, or exact lines.

Use it only to understand:
- final script structure;
- first-person narration;
- paragraph rhythm;
- voiceover-friendly style;
- numbers written as words;
- no scene labels;
- no planning notes;
- no bullet points inside the script;
- avatar line format;
- continuation style.

In real output, Stage 04 must write from the approved Stage 03 Scene Cards only.

The real script must follow:
- one hundred twenty thousand to one hundred thirty thousand characters total;
- normal paragraphs between one hundred twenty and two hundred twenty characters;
- all numbers written as words;
- exactly three [AVATAR] lines across the full script if avatar commentary is enabled;
- each avatar text after the tag between three hundred and four hundred characters.

This example is intentionally short.
It demonstrates format, not full length.
==================================================
COMPACT EXAMPLE 04 FINAL SCRIPT RESPONSE
==================================================

PART ONE — THE DEMO THAT WAS STOLEN

The first thing I saw was my own demo freezing on the main screen. Not crashing, not loading, but being overwritten by an interface I had buried years ago.

The investors stopped whispering the moment Damon walked in. His new system profile appeared above him like the room had already chosen its winner.

Yesterday, he was my best friend. Today, the screen called him a system-backed founder, and everyone looked at me like I had become background noise.

Mira stood beside me until the applause started. Then her hand slipped away from my sleeve, and I knew the room had taken her before Damon spoke.

Damon smiled at the projection and told them I had confused hard work with destiny. The crowd laughed because the system had made cruelty sound official.

I did not answer him. I was looking at the lower corner of the interface, where a small beta build line flickered under the reward animation.

That line should not have existed. I wrote it in an old architecture test, back when the system was not supposed to choose anyone.

Mira stepped beside Damon when he called her name. She did not look back immediately, because looking back would have forced her to see what she was doing.

[AVATAR] Notice what happens under status pressure. Mira is not choosing truth in this moment; she is choosing the person the room has already approved. People often treat public validation like evidence, especially when they are afraid of being attached to failure. That does not make her innocent, but it explains why betrayal can feel logical to the person doing it.

Damon received his first reward in front of everyone. The screen called it a founder privilege package, and the investors reacted like money had become proof.

But beneath the reward line, another phrase unfolded for less than a second. Conditional benefit pending liability review.

The room saw a billionaire being born. I saw a debt marker wearing the costume of a gift, and for the first time that day, my anger became useful.

I let Damon enjoy the applause. I let Mira stand beside him. I let the investors erase me from a project they had not even understood yet.

Because the system had not crowned Damon as king. It had only started recording how far he was willing to go before the rules turned around.

PART TWO — THE FIRST REWARD, THE FIRST DEBT

Damon’s first reward opened the investor lounge for him like he owned the building. My badge failed at the same door five minutes later.

The guard did not insult me. He only looked at the red denial on the scanner, and somehow that felt worse than if he had laughed.

Mira watched from inside the glass wall. Damon placed one hand on her shoulder, not gently, but publicly, like she was part of the reward.

I checked the scanner reflection instead of his face. The access denial had created another timestamp, and timestamps were harder to erase than pride.

CONTINUE FROM: PART TWO — Damon uses the first system reward to push Kai out of the investor circle.`}
                  </div>
                )}
              </div>

              {/* Sub-selector tabs */}
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
                {state.scriptParts.map(p => {
                  const partLen = p.output ? p.output.length : 0;
                  const isSelect = selectedPartNum === p.number;
                  
                  return (
                    <button
                      key={p.number}
                      onClick={() => setSelectedPartNum(p.number)}
                      className={`py-2 px-1.5 rounded border text-center transition-all focus:outline-none ${
                        isSelect 
                          ? "bg-blue-500/10 border-blue-500/30 text-white font-bold ring-1 ring-blue-500/20" 
                          : "bg-[#0A0B0E]/60 border-white/5 text-slate-400 hover:bg-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="text-[9px] font-mono tracking-wider font-bold truncate uppercase">{p.title}</div>
                      <div className="text-[10px] font-mono mt-0.5 text-slate-500">{partLen > 0 ? `${(partLen / 1000).toFixed(1)}k` : "0k"}</div>
                    </button>
                  );
                })}
              </div>

              {/* Active Part Controls */}
              {(() => {
                const activePart = state.scriptParts.find(p => p.number === selectedPartNum);
                if (!activePart) return null;

                const requiresAvatar = state.avatarCommentaryEnabled && (activePart.number === 3 || activePart.number === 6 || activePart.number === 9);

                return (
                  <div className="bg-black/20 border border-white/5 rounded p-4 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase">
                          {activePart.title} EDITOR
                        </span>
                        {requiresAvatar && (
                          <span className="text-[9px] font-mono font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded select-none animate-pulse border border-amber-500/20">
                            ★ REQUIRES EXACTLY ONE [AVATAR] COMMENTARY
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {isAutoGenerating && (
                          <button
                            onClick={handleCancelAutoGenerate}
                            className="py-1.5 px-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-xs font-mono font-bold text-red-400 rounded flex items-center justify-center gap-1 focus:outline-none"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Stop Auto
                          </button>
                        )}

                        <button
                          onClick={handleAutoGenerateFullScript}
                          disabled={isGeneratingPart || isAutoGenerating}
                          className="py-1.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 text-xs font-mono font-bold text-white rounded flex items-center justify-center gap-1 focus:outline-none shadow-lg shadow-blue-600/20"
                          title="Generate all remaining parts sequentially"
                        >
                          {isAutoGenerating ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Zap className="w-3.5 h-3.5" />
                          )}
                          {isAutoGenerating 
                            ? "Auto-writing..." 
                            : (state.scriptParts.some(p => p.status === 'approved' || p.output.length > 0) ? "Resume Auto-Write" : "Auto-Generate All")}
                        </button>

                        <button
                          onClick={handleClearScriptOnly}
                          className="py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono font-bold text-slate-400 hover:text-white rounded flex items-center justify-center gap-1 focus:outline-none"
                          title="Clear current script parts"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Clear Script
                        </button>

                        <button
                          onClick={() => handleGenerateScriptPart(activePart.number)}
                          disabled={isGeneratingPart || isAutoGenerating}
                          className="py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono font-bold text-blue-400 hover:text-white rounded flex items-center justify-center gap-1 focus:outline-none disabled:opacity-45"
                        >
                          {isGeneratingPart ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                          Generate {activePart.title}
                        </button>

                        <button
                          onClick={() => handleApproveScriptPart(activePart.number)}
                          disabled={!activePart.output}
                          className={`py-1.5 px-3 text-xs font-mono font-bold rounded flex items-center justify-center gap-1 focus:outline-none ${
                            activePart.status === "approved" 
                              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 cursor-default" 
                              : "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" /> {activePart.status === "approved" ? "Part Approved" : "Approve Part"}
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={activePart.output}
                      onChange={(e) => handleSavePartEdits(activePart.number, e.target.value)}
                      placeholder={`Drafted layout of ${activePart.title} will load here. You can edit the text directly at any time...`}
                      rows={14}
                      className="w-full bg-[#0A0B0E]/60 border border-white/5 rounded p-4 text-xs font-mono text-slate-300 leading-relaxed placeholder-slate-700 focus:outline-none focus:border-white/10"
                    />

                    {activePart.memory && (
                      <div className="flex flex-col gap-1.5 bg-fuchsia-500/5 border border-fuchsia-500/10 p-3 rounded">
                        <label className="text-[10px] font-mono font-bold text-fuchsia-400 uppercase tracking-tighter flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3" /> AI Memory / Style Avoidance Log
                        </label>
                        <div className="text-[11px] font-mono text-fuchsia-200/70 whitespace-pre-wrap leading-relaxed bg-black/40 p-2 rounded">
                          {activePart.memory}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5 bg-blue-500/5 border border-blue-500/10 p-3 rounded">
                      <label className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-tighter flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3" /> Part Feedback & Revision Instructions
                      </label>
                      <textarea
                        value={activePart.feedback || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setState(prev => ({
                            ...prev,
                            scriptParts: prev.scriptParts.map(p => p.number === activePart.number ? { ...p, feedback: val } : p)
                          }));
                        }}
                        placeholder="Tell AI what to change or avoid in this specific part... (e.g. 'remove metaphors', 'add more tension between Damon and Mira')"
                        className="w-full bg-black/40 border border-white/5 rounded p-2 text-xs font-mono text-blue-200 focus:outline-none focus:border-blue-500/20 min-h-[60px]"
                      />
                      <p className="text-[9px] font-mono text-slate-500">Writing feedback here and clicking "Generate" will force the AI to rewrite this part incorporating your changes.</p>
                    </div>

                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                      <span>Paragraph rule lock: 120-220 chars per normal block.</span>
                      <span>Length of this part: <strong className="text-slate-300">{activePart.output.length} characters</strong></span>
                    </div>
                  </div>
                );
              })()}
            </section>
          )}

          {/* Generated Stage Outputs Panel  */}
          <section className="bg-[#13151A] border border-white/10 rounded-lg p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Stage Output & Verified Logs
              </h3>

              {!isEditing && activeStageData.output && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-xs font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 focus:outline-none"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit Generated Text inline
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-mono text-slate-500">Draft Output Visual Document</label>
                    <textarea
                      value={tempOutput}
                      onChange={(e) => setTempOutput(e.target.value)}
                      rows={15}
                      className="w-full bg-[#0A0B0E]/60 border border-white/5 rounded p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-white/10"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-mono text-slate-500">Handoff Package YAML-Block</label>
                    <textarea
                      value={tempHandoff}
                      onChange={(e) => setTempHandoff(e.target.value)}
                      rows={15}
                      className="w-full bg-[#0A0B0E]/60 border border-white/5 rounded p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-white/10"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="py-1.5 px-4 bg-transparent hover:bg-white/5 text-xs font-mono text-slate-400 hover:text-white rounded focus:outline-none"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdits}
                    className="py-1.5 px-4 bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white uppercase tracking-wider rounded flex items-center gap-1.5 focus:outline-none shadow-lg shadow-blue-600/20"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-100" /> Save modifications
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {activeStageData.output ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2 flex flex-col gap-2">
                       <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest font-bold">Generated Documentation</span>
                      <div className="bg-black/30 border border-white/5 rounded p-5 text-sm leading-relaxed text-slate-300 font-sans max-h-[500px] overflow-y-auto whitespace-pre-wrap select-text">
                        {activeStageData.output}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest font-bold">Stage Handoff Metadata</span>
                      <div className="bg-[#0A0B0E]/60 border border-white/5 rounded p-4 text-xs font-mono text-slate-400 max-h-[500px] overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
                        {activeStageData.handoff}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-20 border border-dashed border-white/5 rounded-lg bg-black/10">
                    <Layers className="w-10 h-10 text-slate-600 mx-auto mb-3.5 animate-pulse" />
                    <p className="text-slate-400 text-xs font-mono uppercase tracking-wider">
                      No draft output generated for STAGE {activeStageConfig.code} yet.
                    </p>
                    <p className="text-slate-500 text-[10px] mt-1.5 font-mono">
                      Feed in inputs or context above and hit "Generate Stage" to trigger.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Right Locks & Checks sidebar panel */}
      <RightPanel 
        state={state} 
        setAvatarCommentaryEnabled={(enabled) => setState(prev => ({ ...prev, avatarCommentaryEnabled: enabled }))}
        onClearProject={handleClearProject}
      />
    </div>
  );
}

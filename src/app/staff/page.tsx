"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpFromLine, ArrowDownToLine, Droplets,
  Plus, X, Send, CheckCircle2, AlertCircle, Loader2,
  Building, CheckSquare, Square, ChevronDown, MapPin
} from "lucide-react";
import QuickSelect from "@/components/QuickSelect";
import { db } from "@/lib/firebase/config";
import {
  collection, getDocs, doc, writeBatch,
  serverTimestamp,
} from "firebase/firestore";

/* ─── Types ─── */
type OpMode = "lend" | "return" | "fill";
type TagType = "normal" | "unused" | "defect";

interface QueueItem {
  uid: string;
  tankId: string;
  status?: string;
  valid: boolean;
  error?: string;
  tag: TagType;
}

interface TankDoc {
  id: string;
  status: string;
  location: string;
  staff: string;
}

const MODE_CONFIG = {
  lend: {
    label: "貸出",
    icon: ArrowUpFromLine,
    color: "#3b82f6", // Blue
    bg: "#eff6ff",
    allowedPrev: ["充填済み", "保管中"],
    nextStatus: "貸出中",
    logAction: "貸出",
  },
  return: {
    label: "返却",
    icon: ArrowDownToLine,
    color: "#10b981", // Green
    bg: "#ecfdf5",
    allowedPrev: ["貸出中", "未返却", "自社利用中"],
    nextStatus: "空",
    logAction: "返却",
  },
  fill: {
    label: "充填",
    icon: Droplets,
    color: "#f59e0b", // Amber/Orange
    bg: "#fffbeb",
    allowedPrev: ["空"],
    nextStatus: "充填済み",
    logAction: "充填",
  },
} as const;

const SPECIAL_STATUSES = ["", "新規登録", "不明", "メンテナンス完了"];

export default function OperationsPage() {
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode") as OpMode | null;
  const [mode, setMode] = useState<OpMode>(modeParam || "lend");

  useEffect(() => {
    if (modeParam && MODE_CONFIG[modeParam]) setMode(modeParam);
  }, [modeParam]);

  const config = MODE_CONFIG[mode];
  const Icon = config.icon;

  // Master Data
  const [allTanks, setAllTanks] = useState<Record<string, TankDoc>>({});
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Operation State
  const [selectedDest, setSelectedDest] = useState<string>("");
  const [returnTag, setReturnTag] = useState<TagType>("normal");
  const [opQueue, setOpQueue] = useState<QueueItem[]>([]);
  
  // Dial / Input State
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Submit State
  const [submitting, setSubmitting] = useState(false);

  const [scrollPos, setScrollPos] = useState(0);
  const dialContainerRef = useRef<HTMLDivElement>(null);
  const [dialMetrics, setDialMetrics] = useState({ gap: 16, blockHeight: 64 });

  useEffect(() => {
    const updateMetrics = () => {
      if (dialContainerRef.current && prefixes.length > 0) {
        const h = dialContainerRef.current.offsetHeight;
        if (h > 0) {
          // Calculate gap to fill height exactly if possible
          // Container height minus bottom margin (16) minus items (n*48) divided by (n-1) gaps
          const n = prefixes.length;
          const totalItemHeight = n * 48;
          const availableSpace = h - 16 - totalItemHeight;
          const calculatedGap = n > 1 ? Math.max(16, availableSpace / (n - 1)) : 16;
          
          setDialMetrics({
            gap: calculatedGap,
            blockHeight: 48 + calculatedGap
          });
        }
      }
    };

    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    return () => window.removeEventListener("resize", updateMetrics);
  }, [prefixes, loading]); // Recalculate when prefixes are loaded or changed

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const tankSnap = await getDocs(collection(db, "tanks"));
      const tankMap: Record<string, TankDoc> = {};
      const pSet = new Set<string>();

      tankSnap.forEach((d) => {
        const t = { id: d.id, ...d.data() } as TankDoc;
        tankMap[d.id] = t;
        const match = t.id.match(/^([A-Z]+)/i);
        if (match) pSet.add(match[1].toUpperCase());
      });

      setAllTanks(tankMap);
      setPrefixes(Array.from(pSet).sort());

      const custSnap = await getDocs(collection(db, "customers"));
      const dests: string[] = [];
      custSnap.forEach((d) => {
        const data = d.data();
        if (data.isActive !== false) dests.push(data.name);
      });
      setDestinations(dests);
      if (dests.length > 0) setSelectedDest(dests[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset state on mode change
  useEffect(() => {
    setOpQueue([]);
    setReturnTag("normal");
    setInputValue("");
    setActivePrefix(null);
  }, [mode]);

  /* ─── Input Handling ─── */
  const focusInput = (prefix: string) => {
    setActivePrefix(prefix);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only numbers
    const val = e.target.value.replace(/[^0-9]/g, "");
    if (val.length > 2) return;
    setInputValue(val);

    if (val.length === 2 && activePrefix) {
      // Auto-submit
      const tankId = `${activePrefix}-${val}`;
      addToQueue(tankId);
      
      // Clear for next input but keep focus
      setInputValue("");
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleManualOkTrigger = () => {
    if (!activePrefix) return;
    let payload = inputValue;
    if (!payload) payload = "OK";
    
    const tankId = `${activePrefix}-${payload}`;
    addToQueue(tankId);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  };

  const addToQueue = (tankId: string) => {
    if (opQueue.some((q) => q.tankId === tankId)) return; // No duplicates

    const tank = allTanks[tankId];
    const currentStatus = tank?.status || "";
    let valid = true;
    let error = "";

    if (!tank) {
      valid = false;
      error = "未登録タンク";
    } else if (!SPECIAL_STATUSES.includes(currentStatus)) {
      if (!(config.allowedPrev as readonly string[]).includes(currentStatus)) {
        valid = false;
        error = `[${currentStatus}] は不可`;
      }
    }

    setOpQueue((prev) => [
      { uid: `${Date.now()}_${Math.random()}`, tankId, status: currentStatus, valid, error, tag: returnTag },
      ...prev, // Unshift to top
    ]);

    setLastAdded(tankId);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      setLastAdded(null);
    }, 1500);
  };

  const removeFromQueue = (uid: string) => {
    setOpQueue((prev) => prev.filter((q) => q.uid !== uid));
  };

  /* ─── Submit ─── */
  const handleSubmit = async (skipConfirm = false) => {
    const validItems = opQueue.filter((q) => q.valid);
    if (validItems.length === 0) return;

    if (mode === "lend" && !selectedDest) {
      alert("貸出先を選択してください。");
      return;
    }

    if (!skipConfirm && !confirm(`${config.label}：${validItems.length}本を処理しますか？`)) return;

    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const staffName = JSON.parse(localStorage.getItem("staffSession") || "{}").name || "スタッフ";

      validItems.forEach((item) => {
        let finalStatus: string = config.nextStatus;
        let finalLocation: string = "倉庫";
        let finalAction: string = config.logAction;
        let finalNote: string = "";

        if (mode === "lend") {
          finalLocation = selectedDest;
        } else if (mode === "return") {
           if (item.tag === "unused") {
             finalStatus = "充填済み";
             finalAction = "未使用返却";
             finalNote = "[TAG:unused]";
           } else if (item.tag === "defect") {
             finalStatus = "空";
             finalAction = "返却(未充填)";
             finalNote = "[TAG:defect]";
           }
        }

        const tankRef = doc(db, "tanks", item.tankId);
        batch.set(tankRef, {
          status: finalStatus,
          location: finalLocation,
          staff: staffName,
          updatedAt: serverTimestamp(),
          logNote: finalNote,
        }, { merge: true });

        const logRef = doc(collection(db, "logs"));
        batch.set(logRef, {
          tankId: item.tankId,
          action: finalAction,
          prevStatus: item.status || "",
          newStatus: finalStatus,
          location: finalLocation,
          staff: staffName,
          timestamp: serverTimestamp(),
          note: finalNote,
        });
      });

      await batch.commit();
      alert(`${validItems.length}本の処理が完了しました`);
      setOpQueue([]);
      fetchData(); // Refresh to get current tank statuses
    } catch (e: any) {
      alert("エラー: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "#94a3b8" }}>
        <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  const validCount = opQueue.filter(q => q.valid).length;

  return (
    <div style={{ 
      display: "flex", flexDirection: "column", height: "100dvh",
      background: "#f8fafc", overflow: "hidden"
    }}>
      
      {/* Top Bar: Mode Selector */}
      <div style={{ 
        padding: "12px 16px", background: "rgba(255,255,255,0.8)", 
        backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0", zIndex: 10 
      }}>
        <div style={{ display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
          {(["lend", "return", "fill"] as OpMode[]).map((m) => {
            const mc = MODE_CONFIG[m];
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 0", borderRadius: 10, border: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? mc.color : "#94a3b8",
                  fontWeight: active ? 800 : 600, fontSize: 13,
                  cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: active ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                }}
              >
                <mc.icon size={16} />
                {mc.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area: Split 70/30 */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        
        {/* Left/Center Column: Settings & Queue */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          
          {/* Top OK Button Area */}
          <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
            <button
              onClick={handleManualOkTrigger}
              disabled={!activePrefix}
              style={{
                width: "100%", padding: "14px", borderRadius: 12, border: "none",
                background: lastAdded ? "#10b981" : (activePrefix ? config.color : "#e2e8f0"),
                color: (activePrefix || lastAdded) ? "#fff" : "#94a3b8",
                fontSize: 20, fontWeight: 900,
                boxShadow: (activePrefix || lastAdded) ? `0 4px 12px ${lastAdded ? '#10b981' : config.color}40` : "none",
                cursor: activePrefix ? "pointer" : "not-allowed",
                transition: "background 0.2s, box-shadow 0.2s"
              }}
            >
              {lastAdded
                ? lastAdded
                : (!activePrefix ? "OK入力" : inputValue ? `${activePrefix} - ${inputValue}` : `${activePrefix} - OK`)}
            </button>
          </div>

          {/* Queue List (Scrollable) */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>送信リスト</span>
              {opQueue.length > 0 && (
                <span style={{ background: config.color, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 800 }}>
                  {opQueue.length}
                </span>
              )}
            </div>

            {opQueue.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#cbd5e1", marginTop: 20 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>右側のリストからアルファベットを選び、</p>
                <p style={{ margin: "4px 0", fontSize: 14, fontWeight: 600 }}>タンクの数字を入力してください</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {opQueue.map((item) => (
                  <div key={item.uid} className="queue-anim" style={{ 
                    background: "#fff", padding: "12px 16px", borderRadius: 12,
                    borderLeft: `5px solid ${item.valid ? config.color : "#ef4444"}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    animation: "slideInLeft 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
                  }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.05em", color: "#0f172a" }}>
                          {item.tankId}
                        </span>
                        {item.tag !== "normal" && (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: item.tag === "unused" ? "#d1fae5" : "#fee2e2", color: item.tag === "unused" ? "#047857" : "#b91c1c" }}>
                            {item.tag === "unused" ? "未使用" : "未充填"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: item.valid ? "#64748b" : "#ef4444", fontWeight: 600, marginTop: 4 }}>
                        {item.valid ? `現在: ${item.status || "不明"} ` : item.error}
                      </div>
                    </div>
                    <button onClick={() => removeFromQueue(item.uid)} style={{ border: "none", background: "none", color: "#cbd5e1", padding: 8, cursor: "pointer", marginRight: -8 }}>
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stable Action Area */}
          <div style={{ 
            padding: "8px 16px max(8px, env(safe-area-inset-bottom, 8px))", 
            background: "#fff", borderTop: "1px solid #e2e8f0",
            display: "flex", flexDirection: "column", gap: 8, flexShrink: 0,
            zIndex: 20
          }}>
            {mode === "lend" && (
              <QuickSelect
                options={destinations}
                value={selectedDest}
                onChange={setSelectedDest}
                onConfirm={() => handleSubmit(true)}
                color={config.color}
                placeholder="貸出先を選択して実行..."
              />
            )}
            
            {(mode === "return" || mode === "fill") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mode === "return" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {([
                      { id: "normal", label: "通常", icon: CheckCircle2, color: "#64748b" },
                      { id: "unused", label: "未使用", icon: Droplets, color: "#10b981" },
                      { id: "defect", label: "未充填", icon: AlertCircle, color: "#ef4444" }
                    ] as const).map(tag => {
                      const active = returnTag === tag.id;
                      return (
                        <button
                          key={tag.id}
                          onClick={() => setReturnTag(tag.id as TagType)}
                          style={{
                            flex: 1, padding: "8px 4px", borderRadius: 10,
                            background: active ? `${tag.color}15` : "#fff",
                            border: `2px solid ${active ? tag.color : "#e2e8f0"}`,
                            color: active ? tag.color : "#64748b",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                            cursor: "pointer", transition: "all 0.15s",
                          }}
                        >
                          <tag.icon size={14} />
                          <span style={{ fontSize: 10, fontWeight: 800 }}>{tag.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => handleSubmit()}
                  disabled={submitting || opQueue.length === 0}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: validCount > 0 ? config.color : "#e2e8f0", 
                    color: validCount > 0 ? "#fff" : "#94a3b8",
                    fontSize: 16, fontWeight: 900,
                    display: "flex", justifyContent: "center", alignItems: "center", gap: 8,
                    cursor: (submitting || opQueue.length === 0) ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
                  <span>{validCount}件の{config.label}を実行</span>
                </button>
              </div>
            )}
          </div>
          </div>

          {/* Right Column: Prefix List */}
          <div style={{ 
            width: 70, background: "#fff", borderLeft: "1px solid #e2e8f0", 
            display: "flex", flexDirection: "column", position: "relative"
          }}>
          {prefixes.length > 0 && (
            <>
              {/* Bottom Appeal Frame (Targeting Box) */}
              <div style={{
                position: "absolute", bottom: 16, left: 6, right: 6, height: 48,
                border: `3px solid ${config.color}`, borderRadius: 12, pointerEvents: "none", zIndex: 10,
                background: `${config.color}0A`
              }} />

              {/* Invisible auto-submit input overlay */}
              <input
                ref={inputRef}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={inputValue}
                onChange={handleInputChange}
                style={{ position: "absolute", opacity: 0.01, zIndex: -1 /* Keeps numeric keyboard open */ }}
              />

              {/* Native Scroll Container */}
              <div 
                ref={dialContainerRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const { blockHeight } = dialMetrics;
                  const rawIdx = Math.round(el.scrollTop / blockHeight);
                  const wrappedIdx = rawIdx % prefixes.length;
                  if (prefixes[wrappedIdx] && prefixes[wrappedIdx] !== activePrefix) {
                    setActivePrefix(prefixes[wrappedIdx]);
                  }
                  const cycleHeight = blockHeight * prefixes.length;
                  const totalHeight = cycleHeight * 30;
                  if (el.scrollTop < cycleHeight * 5) {
                    el.scrollTop = el.scrollTop + (cycleHeight * 10);
                  } else if (el.scrollTop > totalHeight - (cycleHeight * 5)) {
                    el.scrollTop = el.scrollTop - (cycleHeight * 10);
                  }
                }}
                style={{
                  flex: 1, overflowY: "auto", 
                  overflowX: "hidden", position: "relative",
                  scrollSnapType: "y mandatory", scrollPaddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))"
                }}
              >
                <div style={{ height: `calc(100% - ${dialMetrics.blockHeight}px)`, flexShrink: 0 }} />
                
                <div style={{ display: "flex", flexDirection: "column", gap: dialMetrics.gap, padding: "0 6px max(12px, env(safe-area-inset-bottom, 12px)) 6px" }}>
                  {/* Fill 30 repetitions of the prefixes */}
                  {Array(30).fill(prefixes).flat().map((p, index) => {
                    const isActive = activePrefix === p;
                    return (
                      <div key={`${p}-${index}`} style={{ scrollSnapAlign: "end", scrollSnapStop: "always" }}>
                        <button
                          onClick={(e) => {
                            focusInput(p);
                            e.currentTarget.scrollIntoView({ behavior: "smooth", block: "end" });
                          }}
                          style={{
                            width: "100%", height: 48, borderRadius: 10, flexShrink: 0,
                            border: "none", background: "transparent",
                            color: isActive ? config.color : "#94a3b8",
                            fontSize: 22, fontWeight: 900, fontFamily: "monospace",
                            transition: "all 0.15s ease", cursor: "pointer",
                            transform: isActive ? "scale(1.3)" : "scale(1.0)",
                          }}
                        >
                          {p}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

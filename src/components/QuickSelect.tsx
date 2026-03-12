"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";

interface QuickSelectProps {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  onConfirm?: (val: string) => void;
  color: string;
  placeholder?: string;
}

export default function QuickSelect({
  options,
  value,
  onChange,
  onConfirm,
  color,
  placeholder = "選択してください",
}: QuickSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSwipeMode, setIsSwipeMode] = useState(false);
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const [openUpwards, setOpenUpwards] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const checkPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const distanceToBottom = window.innerHeight - rect.bottom;
      // If less than 320px (menu height approx) remains, flip it
      setOpenUpwards(distanceToBottom < 300);
    }
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    checkPosition();
    // Start long press timer
    longPressTimer.current = setTimeout(() => {
      setIsSwipeMode(true);
      setIsOpen(true);
      setHighlightedValue(value || null);
      // Trigger haptic feedback if available
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(10);
      }
    }, 300);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwipeMode) {
      // If we move too much before the long press completes, cancel it
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      return;
    }

    // Capture the touch location
    const touch = e.touches[0];
    const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);

    // Look for our items
    if (elementUnderFinger) {
      const itemElement = elementUnderFinger.closest("[data-quick-select-item]");
      if (itemElement) {
        const val = itemElement.getAttribute("data-quick-select-item");
        if (val && val !== highlightedValue) {
          setHighlightedValue(val);
          // Subtle haptic on transition
          if (window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(5);
          }
        }
      }
    }
    
    // Prevent background scroll
    if (e.cancelable) e.preventDefault();
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (isSwipeMode) {
      if (highlightedValue) {
        onChange(highlightedValue);
        if (onConfirm) onConfirm(highlightedValue);
      }
      setIsSwipeMode(false);
      setIsOpen(false);
      setHighlightedValue(null);
    }
  };

  const toggleMenu = () => {
    if (!isSwipeMode) {
      setIsOpen(!isOpen);
    }
  };

  useEffect(() => {
    if (isOpen) checkPosition();
  }, [isOpen, checkPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div 
      ref={containerRef}
      style={{ position: "relative", width: "100%", userSelect: "none", WebkitUserSelect: "none" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => e.preventDefault()} // Disable system menu
    >
      {/* Trigger Button */}
      <button
        onClick={toggleMenu}
        style={{
          width: "100%", padding: "6px 12px", borderRadius: 10,
          background: "#fff", border: `2px solid ${value ? color : "#cbd5e1"}`,
          color: value ? "#0f172a" : "#64748b",
          fontSize: 13, fontWeight: 700, textAlign: "left",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          transition: "all 0.1s", cursor: "pointer", outline: "none",
          minHeight: 36,
          boxShadow: isOpen ? `0 0 0 3px ${color}15` : "none"
        }}
      >
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {value || placeholder}
        </span>
        <ChevronDown size={18} style={{ opacity: 0.6, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div style={{
          position: "absolute", 
          [openUpwards ? "bottom" : "top"]: "calc(100% + 8px)", 
          left: 0, right: 0,
          background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0",
          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
          zIndex: 1000, overflow: "hidden",
          animation: isSwipeMode ? "none" : "slideDown 0.2s ease-out"
        }}>
          <div style={{ maxHeight: "300px", overflowY: "auto", padding: "8px" }}>
            {options.map((opt) => {
              const isSelected = value === opt;
              const isHighlighted = highlightedValue === opt;
              
              return (
                <div
                  key={opt}
                  data-quick-select-item={opt}
                  onClick={() => {
                    onChange(opt);
                    if (onConfirm) onConfirm(opt);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "10px 14px", borderRadius: 8,
                    fontSize: 14, fontWeight: (isHighlighted || isSelected) ? 800 : 600,
                    color: (isHighlighted || isSelected) ? color : "#475569",
                    background: isHighlighted ? `${color}15` : isSelected ? `${color}0A` : "transparent",
                    transition: "all 0.1s", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "space-between"
                  }}
                >
                  {opt}
                  {(isHighlighted || isSelected) && (
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

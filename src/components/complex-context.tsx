"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getComplexGuardDirectoryAction } from "@/app/actions/complex-guard";
import { getUploadStatusAction } from "@/app/actions/upload-status";
import { findCrossComplexIssues } from "@/lib/complex-guard";
import { emptyUploadStatus, type UploadStatus } from "@/lib/upload-status-keys";

export type ComplexOption = { id: string; name: string };
export type ChainOption = { id: string; name: string };

type ComplexContextValue = {
  complexId: string;
  setComplexId: (id: string) => void;
  complexes: ComplexOption[];
  chains: ChainOption[];
  addComplex: (complex: ComplexOption) => void;
  selectedComplex: ComplexOption | null;
  /**
   * Given building names (or, for missions, template-mission titles)
   * referenced in an upload's rows, returns a list of human-readable
   * problems for any name that looks like it belongs to a DIFFERENT complex
   * than the one currently selected — call this before running an import
   * and block on a non-empty result. Callers must check
   * `guardDirectoryReady` first and block with a "still loading" message
   * when false, rather than treating an empty result as "nothing wrong" —
   * this check is meant to fail closed, not open.
   */
  checkBuildingNames: (names: (string | null | undefined)[]) => string[];
  checkMissionTemplateTitles: (titles: (string | null | undefined)[]) => string[];
  guardDirectoryReady: boolean;
  /**
   * Per-upload-type "does this complex already have at least one record of
   * this kind" flags, used to show done/not-done badges on upload cards and
   * nav tabs. Null while the initial check for the current complex is still
   * in flight. Call refreshUploadStatus() after a successful import so the
   * badges update without a page reload.
   */
  uploadStatus: UploadStatus | null;
  refreshUploadStatus: () => Promise<void>;
};

const ComplexContext = createContext<ComplexContextValue | null>(null);

const STORAGE_KEY = "robust-onboading:selected-complex-id";

export function ComplexProvider({
  initialComplexes,
  initialChains,
  children,
}: {
  initialComplexes: ComplexOption[];
  initialChains: ChainOption[];
  children: React.ReactNode;
}) {
  const [complexes, setComplexes] = useState(initialComplexes);
  const [complexId, setComplexIdState] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [guardDirectory, setGuardDirectory] = useState<{
    buildings: { name: string; complexId: string | null }[];
    missionTemplateTitles: { name: string; complexId: string | null }[];
  } | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setComplexIdState(stored);
    } catch {
      // localStorage unavailable — fall back to no persisted selection.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getComplexGuardDirectoryAction()
      .then((directory) => {
        if (active) setGuardDirectory(directory);
      })
      .catch(() => {
        // Leave guardDirectory null — checks stay blocked (fail closed).
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Drop a persisted selection that no longer refers to a real complex
    // (e.g. it was deleted, or this is a different environment's data).
    if (complexId && !complexes.some((complex) => complex.id === complexId)) {
      setComplexIdState("");
    }
  }, [hydrated, complexId, complexes]);

  const refreshUploadStatus = useCallback(async () => {
    if (!complexId) {
      setUploadStatus(emptyUploadStatus());
      return;
    }
    try {
      const status = await getUploadStatusAction(complexId);
      setUploadStatus(status);
    } catch {
      // Leave the previous status in place — badges just won't update.
    }
  }, [complexId]);

  useEffect(() => {
    setUploadStatus(null);
    void refreshUploadStatus();
  }, [refreshUploadStatus]);

  function setComplexId(id: string) {
    setComplexIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Best-effort persistence only.
    }
  }

  function addComplex(complex: ComplexOption) {
    setComplexes((prev) =>
      [...prev, complex].sort((a, b) => a.name.localeCompare(b.name, "he")),
    );
    setComplexId(complex.id);
  }

  const selectedComplex = useMemo(
    () => complexes.find((complex) => complex.id === complexId) ?? null,
    [complexes, complexId],
  );

  function checkBuildingNames(names: (string | null | undefined)[]) {
    if (!guardDirectory || !complexId) return [];
    return findCrossComplexIssues(names, guardDirectory.buildings, complexId);
  }

  function checkMissionTemplateTitles(titles: (string | null | undefined)[]) {
    if (!guardDirectory || !complexId) return [];
    return findCrossComplexIssues(titles, guardDirectory.missionTemplateTitles, complexId);
  }

  return (
    <ComplexContext.Provider
      value={{
        complexId,
        setComplexId,
        complexes,
        checkBuildingNames,
        checkMissionTemplateTitles,
        guardDirectoryReady: guardDirectory !== null,
        chains: initialChains,
        addComplex,
        selectedComplex,
        uploadStatus,
        refreshUploadStatus,
      }}
    >
      {children}
    </ComplexContext.Provider>
  );
}

export function useComplexContext() {
  const ctx = useContext(ComplexContext);
  if (!ctx) {
    throw new Error("useComplexContext must be used within a ComplexProvider");
  }
  return ctx;
}

import { useEffect, useRef, useState } from "react";
import type { TWikiNode } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";

const service = new WikiService();

export function useWikiFileNavigation(
  workspaceSlug: string,
  currentId: string | undefined,
  navigate: (href: string) => void
) {
  const generation = useRef(0);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ workspace: string; node: TWikiNode } | null>(null);
  const [failed, setFailed] = useState(false);

  const cancel = () => {
    generation.current += 1;
    setLoadingName(null);
  };

  useEffect(() => {
    generation.current += 1;
    setLoadingName(null);
    return () => {
      generation.current += 1;
    };
  }, [workspaceSlug, currentId]);

  const openFile = async (node: TWikiNode) => {
    if (node.id === currentId) return;
    const request = ++generation.current;
    setLoadingName(node.name);
    setFailed(false);
    try {
      const detail = await service.retrieve(workspaceSlug, node.id);
      if (request !== generation.current) return;
      setLoaded({ workspace: workspaceSlug, node: detail });
      setLoadingName(null);
      navigate(`/${workspaceSlug}/wiki/${node.id}`);
    } catch {
      if (request !== generation.current) return;
      setLoadingName(null);
      setFailed(true);
    }
  };

  return { loadingName, loaded, failed, cancel, openFile };
}

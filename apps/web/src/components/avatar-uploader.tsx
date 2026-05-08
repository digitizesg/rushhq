import { useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";

interface AvatarUploaderProps {
  memberId: string;
  shortName: string | null | undefined;
  currentUrl: string | null | undefined;
  /** Background colour for the initials fallback. */
  accent: string;
  /** Text colour for the initials fallback. */
  fallbackText?: string;
  size?: number;
  /** Called after an upload or removal succeeds, so the caller can
   *  refresh whatever local state holds the avatar URL. */
  onChange: () => void | Promise<void>;
}

export function AvatarUploader({
  memberId,
  shortName,
  currentUrl,
  accent,
  fallbackText = "#ffffff",
  size = 80,
  onChange,
}: AvatarUploaderProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Pick a photo under 5 MB.");
      }
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${memberId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("family_members")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", memberId);
      if (updErr) throw updErr;
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("family_members")
        .update({ avatar_url: null })
        .eq("id", memberId);
      if (e) throw e;
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <Avatar
        size={size}
        name={shortName}
        url={currentUrl}
        accent={accent}
        text={fallbackText}
      />
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          disabled={busy}
          className="block text-[14.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary file:text-white file:px-3 file:py-2 file:text-[14px] file:font-medium file:cursor-pointer hover:file:bg-primary-strong disabled:opacity-50"
        />
        <p className="text-[13px] text-muted">JPG or PNG, up to 5 MB.</p>
        {currentUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={busy}
            className="text-muted hover:text-danger"
          >
            Remove photo
          </Button>
        )}
        {error && <p className="text-danger text-[13px]">{error}</p>}
      </div>
    </div>
  );
}

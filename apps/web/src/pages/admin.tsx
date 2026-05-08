import { useEffect, useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import type {
  DispatchLogEntry,
  FamilyMember,
  MemberRole,
  MemberType,
  TelegramContact,
} from "@/lib/types";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { Select } from "@/components/select";
import { TelegramCard } from "@/components/telegram-card";
import { AvatarUploader } from "@/components/avatar-uploader";
import { Avatar } from "@/components/avatar";
import { colourFor } from "@/lib/colours";

interface RowState {
  member: FamilyMember;
  contactState: "loading" | "not-setup" | "pending" | "linked" | "expired";
}

export default function AdminPage() {
  const [rows, setRows] = useState<RowState[]>([]);
  const [logs, setLogs] = useState<DispatchLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [telegramFor, setTelegramFor] = useState<FamilyMember | null>(null);
  const [editing, setEditing] = useState<FamilyMember | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [memberRes, contactRes, logRes] = await Promise.all([
        supabase.from("family_members").select("*").order("short_name"),
        supabase.from("telegram_contacts").select("*"),
        supabase
          .from("notification_dispatch_log")
          .select("*")
          .order("dispatched_at", { ascending: false })
          .limit(50),
      ]);
      if (memberRes.error) throw memberRes.error;
      if (contactRes.error) throw contactRes.error;
      if (logRes.error) throw logRes.error;

      const contactByMember = new Map<string, TelegramContact>(
        ((contactRes.data as TelegramContact[]) ?? []).map((c) => [c.member_id, c]),
      );
      const memberRows = ((memberRes.data as FamilyMember[]) ?? []).map((m) => ({
        member: m,
        contactState: classify(contactByMember.get(m.id) ?? null),
      }));
      setRows(memberRows);
      setLogs((logRes.data as DispatchLogEntry[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[14px] uppercase tracking-wider text-muted mb-1">Admin</p>
          <h1 className="text-[30px] font-medium text-ink">
            Family and dispatch
          </h1>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ Add member</Button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/[0.06] text-danger text-[15px] px-4 py-3">
          {error}
        </div>
      )}

      <section>
        <p className="text-[20px] font-medium text-ink mb-3">Members</p>
        <div className="bg-white border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[16px] min-w-[720px]">
            <thead className="bg-soft text-muted text-left text-[14.5px]">
              <tr>
                <th className="font-medium px-4 py-2.5">Member</th>
                <th className="font-medium px-4 py-2.5">Role</th>
                <th className="font-medium px-4 py-2.5">Type</th>
                <th className="font-medium px-4 py-2.5">Active</th>
                <th className="font-medium px-4 py-2.5">Telegram</th>
                <th className="font-medium px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-muted text-center">Loading…</td>
                </tr>
              )}
              {rows.map((r) => {
                const c = colourFor(r.member.id, r.member.short_name);
                return (
                  <tr key={r.member.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          size={36}
                          name={r.member.short_name}
                          url={r.member.avatar_url}
                          accent={c.accent}
                          text="#ffffff"
                          alt=""
                        />
                        <div>
                          <p className="text-ink">{r.member.short_name}</p>
                          <p className="text-[14px] text-muted">{r.member.full_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted">{r.member.role}</td>
                    <td className="px-4 py-3 capitalize text-muted">{r.member.member_type}</td>
                    <td className="px-4 py-3">
                      <ActiveToggle
                        member={r.member}
                        onChange={(active) => {
                          setRows((prev) =>
                            prev.map((row) =>
                              row.member.id === r.member.id
                                ? { ...row, member: { ...row.member, active } }
                                : row,
                            ),
                          );
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <TelegramBadge state={r.contactState} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing(r.member)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setTelegramFor(r.member)}
                        >
                          Telegram
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="text-[20px] font-medium text-ink mb-3">
          Recent notifications
        </p>
        <div className="bg-white border border-line rounded-lg overflow-x-auto">
          <table className="w-full text-[15.5px] min-w-[720px]">
            <thead className="bg-soft text-muted text-left text-[14.5px]">
              <tr>
                <th className="font-medium px-4 py-2.5">When</th>
                <th className="font-medium px-4 py-2.5">Channel</th>
                <th className="font-medium px-4 py-2.5">Status</th>
                <th className="font-medium px-4 py-2.5">Member</th>
                <th className="font-medium px-4 py-2.5">Scheduled for</th>
                <th className="font-medium px-4 py-2.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-muted text-center">
                    No dispatches yet. The dispatcher fires every five minutes.
                  </td>
                </tr>
              )}
              {logs.map((row) => {
                const member = rows.find((r) => r.member.id === row.member_id)?.member;
                return (
                  <tr key={row.id} className="border-t border-line">
                    <td className="px-4 py-3 tnum text-ink">
                      {format(new Date(row.dispatched_at), "EEE d LLL HH:mm")}
                    </td>
                    <td className="px-4 py-3 capitalize text-ink">{row.channel}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {member?.short_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 tnum text-muted">
                      {row.scheduled_for
                        ? format(new Date(row.scheduled_for), "EEE d LLL HH:mm")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.error_message ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add family member"
      >
        <AddMemberForm
          onAdded={async () => {
            setAddOpen(false);
            await load();
          }}
          onCancelled={() => setAddOpen(false)}
        />
      </Modal>

      <Modal
        open={!!telegramFor}
        onClose={() => setTelegramFor(null)}
        title={telegramFor ? `${telegramFor.short_name} · Telegram` : ""}
      >
        {telegramFor && (
          <TelegramCard
            memberId={telegramFor.id}
            heading={`${telegramFor.short_name}'s Telegram`}
          />
        )}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.short_name}` : ""}
        size="lg"
      >
        {editing && (
          <EditMemberForm
            key={editing.id}
            member={editing}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
            onCancelled={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

interface EditMemberFormProps {
  member: FamilyMember;
  onSaved: () => Promise<void>;
  onCancelled: () => void;
}

function EditMemberForm({ member, onSaved, onCancelled }: EditMemberFormProps) {
  const [shortName, setShortName] = useState(member.short_name);
  const [fullName, setFullName] = useState(member.full_name);
  const [email, setEmail] = useState(member.email ?? "");
  const [role, setRole] = useState<MemberRole>(member.role);
  const [memberType, setMemberType] = useState<MemberType>(member.member_type);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const colour = colourFor(member.id, member.short_name);

  // Re-fetch the member after avatar change so the preview updates.
  const [currentAvatar, setCurrentAvatar] = useState<string | null>(member.avatar_url);

  async function refreshAvatar() {
    setAvatarVersion((v) => v + 1);
    const { data } = await supabase
      .from("family_members")
      .select("avatar_url")
      .eq("id", member.id)
      .single();
    setCurrentAvatar((data as { avatar_url: string | null } | null)?.avatar_url ?? null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!shortName.trim() || !fullName.trim()) {
      setError("Short name and full name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: updErr } = await supabase
        .from("family_members")
        .update({
          short_name: shortName.trim(),
          full_name: fullName.trim(),
          email: email.trim() || null,
          role,
          member_type: memberType,
        })
        .eq("id", member.id);
      if (updErr) throw updErr;
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
          Profile photo
        </h3>
        <AvatarUploader
          key={avatarVersion}
          memberId={member.id}
          shortName={shortName}
          currentUrl={currentAvatar}
          accent={colour.accent}
          onChange={refreshAvatar}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
          Details
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <TextField
            label="Short name"
            required
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
          <TextField
            label="Full name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint={
            member.auth_user_id
              ? "This person already has a sign-in. Changing the email here only updates the family record, not their auth account."
              : "Used for the invite email if they later get a sign-in."
          }
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
          >
            <option value="parent">Parent</option>
            <option value="helper">Helper</option>
            <option value="child">Child</option>
          </Select>
          <Select
            label="Member type"
            value={memberType}
            onChange={(e) => setMemberType(e.target.value as MemberType)}
          >
            <option value="parent">Parent</option>
            <option value="helper">Helper</option>
            <option value="child">Child</option>
          </Select>
        </div>
      </section>

      {error && <p role="alert" className="text-danger text-[15px]">{error}</p>}

      <div className="flex justify-end gap-2 pt-3 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function classify(c: TelegramContact | null): RowState["contactState"] {
  if (!c) return "not-setup";
  if (c.chat_id != null) return "linked";
  if (c.pending_token && c.pending_token_expires_at) {
    return new Date(c.pending_token_expires_at) > new Date() ? "pending" : "expired";
  }
  return "not-setup";
}

function TelegramBadge({ state }: { state: RowState["contactState"] }) {
  const styles: Record<RowState["contactState"], { bg: string; text: string; label: string }> = {
    "not-setup": { bg: "bg-soft", text: "text-muted", label: "Not set up" },
    pending:    { bg: "bg-soft", text: "text-amber", label: "Pending" },
    expired:    { bg: "bg-soft", text: "text-danger", label: "Expired" },
    linked:     { bg: "bg-primary-soft", text: "text-primary", label: "Linked" },
    loading:    { bg: "bg-soft", text: "text-muted", label: "…" },
  };
  const s = styles[state];
  return (
    <span className={`inline-flex items-center px-2 h-6 rounded-full text-[14px] ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function StatusPill({ status }: { status: DispatchLogEntry["status"] }) {
  const map: Record<DispatchLogEntry["status"], { bg: string; text: string }> = {
    sent:    { bg: "bg-primary-soft", text: "text-primary" },
    queued:  { bg: "bg-soft", text: "text-muted" },
    skipped: { bg: "bg-soft", text: "text-muted" },
    failed:  { bg: "bg-soft", text: "text-danger" },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center px-2 h-6 rounded-full text-[14px] capitalize ${s.bg} ${s.text}`}>
      {status}
    </span>
  );
}

function ActiveToggle({
  member,
  onChange,
}: {
  member: FamilyMember;
  onChange: (active: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={member.active}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const next = !member.active;
        const { error } = await supabase
          .from("family_members")
          .update({ active: next })
          .eq("id", member.id);
        setBusy(false);
        if (!error) onChange(next);
      }}
      className={[
        "relative inline-flex h-5 w-9 rounded-full transition-colors",
        member.active ? "bg-primary" : "bg-line",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: member.active ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

interface AddMemberFormProps {
  onAdded: () => Promise<void>;
  onCancelled: () => void;
}

function AddMemberForm({ onAdded, onCancelled }: AddMemberFormProps) {
  const [shortName, setShortName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("helper");
  const [memberType, setMemberType] = useState<MemberType>("helper");
  const [sendInvite, setSendInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep memberType in step with role unless the operator explicitly
  // changed it. Simple heuristic: type defaults to whatever the role
  // currently is.
  const inferredType = useMemo<MemberType>(() => role, [role]);
  const effectiveType = memberType === inferredType ? inferredType : memberType;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!shortName.trim() || !fullName.trim()) {
      setError("Short name and full name are required.");
      return;
    }

    setSubmitting(true);
    try {
      // The create-family-member edge function handles auth-user
      // creation + the family_members insert atomically. Authorization
      // header is the caller's session token; the function verifies
      // the caller is a parent before doing anything.
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-family-member`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            short_name: shortName.trim(),
            full_name: fullName.trim(),
            email: email.trim() || undefined,
            role,
            member_type: effectiveType,
            invite: !!email.trim() && sendInvite,
          }),
        },
      );
      const data = (await res.json()) as { id?: string; error?: string; invited?: boolean };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Request failed with ${res.status}`);
      }
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const emailPresent = !!email.trim();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField
          label="Short name"
          required
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
        />
        <TextField
          label="Full name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="Leave empty for kids without a sign-in. Otherwise we'll create their account."
      />
      {emailPresent && (
        <label className="flex items-start gap-2.5 rounded-md border border-line bg-soft px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-line accent-primary"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
          />
          <span className="text-[15.5px] text-ink">
            Send them an invite email
            <span className="block text-[14.5px] text-muted mt-0.5">
              They'll get a link from {`<notify@rushhq.co>`} to set their own password.
              Without this, the account is created but you'll need to share credentials another way.
            </span>
          </span>
        </label>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
          <option value="parent">Parent</option>
          <option value="helper">Helper</option>
          <option value="child">Child</option>
        </Select>
        <Select
          label="Member type"
          value={memberType}
          onChange={(e) => setMemberType(e.target.value as MemberType)}
        >
          <option value="parent">Parent</option>
          <option value="helper">Helper</option>
          <option value="child">Child</option>
        </Select>
      </div>
      {error && (
        <p role="alert" className="text-danger text-[15px]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button type="button" variant="secondary" onClick={onCancelled}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Add member
        </Button>
      </div>
    </form>
  );
}

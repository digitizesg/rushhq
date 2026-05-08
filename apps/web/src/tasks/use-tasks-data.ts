import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { FamilyMember } from "@/lib/types";
import type { TaskReminderRow, TaskRow } from "@/lib/tasks";

export interface TasksData {
  loading: boolean;
  error: string | null;
  tasks: TaskRow[];
  reminders: TaskReminderRow[];
  members: FamilyMember[];
  reload: () => Promise<void>;
}

export function useTasksData(): TasksData {
  const [state, setState] = useState<Omit<TasksData, "reload">>({
    loading: true,
    error: null,
    tasks: [],
    reminders: [],
    members: [],
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [tRes, rRes, mRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("*")
          .order("due_date", { ascending: true }),
        supabase.from("task_reminders").select("*"),
        supabase
          .from("family_members")
          .select("*")
          .eq("active", true)
          .order("short_name"),
      ]);
      for (const r of [tRes, rRes, mRes]) if (r.error) throw r.error;
      setState({
        loading: false,
        error: null,
        tasks: (tRes.data ?? []) as TaskRow[],
        reminders: (rRes.data ?? []) as TaskReminderRow[],
        members: (mRes.data ?? []) as FamilyMember[],
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}

import { Button } from "@/components/button";
import { useAuth } from "@/auth/auth-context";

export default function NoProfilePage() {
  const { user, signOut } = useAuth();
  return (
    <main className="min-h-dvh grid place-items-center px-6 py-12">
      <div className="w-full max-w-md bg-white border border-line rounded-lg p-7">
        <p className="text-2xl text-ink mb-1">Account not linked</p>
        <p className="text-muted text-[14px] mb-6">
          Your sign-in worked, but no Rush HQ profile is linked to{" "}
          <span className="text-ink">{user?.email}</span> yet. Ask Ben or Alice
          to link the auth user to your family member record from Admin, then
          sign in again.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}

import {
  Activity,
  BookOpen,
  CalendarDays,
  Heart,
  Star,
  Sun,
  Trophy,
  type LucideIcon,
} from "lucide-react";

// Map of names stored in bead_categories.icon to a Lucide component.
// Add to this map when introducing new categories.
const REGISTRY: Record<string, LucideIcon> = {
  Sun,
  BookOpen,
  Trophy,
  Activity,
  Heart,
  Star,
  CalendarDays,
};

interface CategoryIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function CategoryIcon({ name, size = 16, className }: CategoryIconProps) {
  const Comp = REGISTRY[name] ?? Star;
  return <Comp size={size} className={className} aria-hidden />;
}

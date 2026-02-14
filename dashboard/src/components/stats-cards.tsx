import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ZapIcon, DownloadIcon, LayoutGridIcon } from "lucide-react";
import type { SkillWithStatus } from "@/types";

interface StatsCardsProps {
  skills: SkillWithStatus[];
}

export function StatsCards({ skills }: StatsCardsProps) {
  const total = skills.length;
  const installed = skills.filter((s) => s.installed).length;
  const categories = new Set(skills.map((s) => s.category)).size;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ZapIcon className="size-4" />
            Total Skills
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{total}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DownloadIcon className="size-4" />
            Installed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {installed}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <LayoutGridIcon className="size-4" />
            Categories
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{categories}</div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { PlusCircle, Rows3, KanbanSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LeadTable } from "@/components/leads/LeadTable";
import { LeadKanban } from "@/components/leads/LeadKanban";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export default function LeadsPage() {
  const [view, setView] = useState<"list" | "kanban">("list");

  const buckets = {
    all: [] as any[],
    new: [] as any[],
    contacted: [] as any[],
    appointments: [] as any[],
    closed: [] as any[],
  };

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Manage every IUL lead you've purchased — statuses, tasks, notes, dispositions, and consent records all in one place."
        actions={
          <>
            <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
              <button
                onClick={() => setView("list")}
                className={cn(
                  "px-3 py-2 text-xs flex items-center gap-1.5 transition-colors",
                  view === "list"
                    ? "bg-slate-200 text-foreground"
                    : "text-muted-foreground hover:bg-slate-100",
                )}
              >
                <Rows3 className="h-3.5 w-3.5" /> List
              </button>
              <button
                onClick={() => setView("kanban")}
                className={cn(
                  "px-3 py-2 text-xs flex items-center gap-1.5 transition-colors border-l border-slate-300",
                  view === "kanban"
                    ? "bg-slate-200 text-foreground"
                    : "text-muted-foreground hover:bg-slate-100",
                )}
              >
                <KanbanSquare className="h-3.5 w-3.5" /> Pipeline
              </button>
            </div>
            <Link href="/marketplace">
              <Button size="sm" variant="outline">
                <PlusCircle className="h-4 w-4" />
                Order more leads
              </Button>
            </Link>
          </>
        }
      />

      {view === "list" ? (
        <Card className="p-5">
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All ({buckets.all.length})</TabsTrigger>
              <TabsTrigger value="new">New ({buckets.new.length})</TabsTrigger>
              <TabsTrigger value="contacted">Contacted ({buckets.contacted.length})</TabsTrigger>
              <TabsTrigger value="appt">Appointments ({buckets.appointments.length})</TabsTrigger>
              <TabsTrigger value="closed">Closed ({buckets.closed.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <LeadTable leads={buckets.all} />
            </TabsContent>
            <TabsContent value="new">
              <LeadTable leads={buckets.new} />
            </TabsContent>
            <TabsContent value="contacted">
              <LeadTable leads={buckets.contacted} />
            </TabsContent>
            <TabsContent value="appt">
              <LeadTable leads={buckets.appointments} />
            </TabsContent>
            <TabsContent value="closed">
              <LeadTable leads={buckets.closed} />
            </TabsContent>
          </Tabs>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Pipeline view</h3>
            <p className="text-xs text-muted-foreground">
              Drag leads between stages to update their status. Click any card to open the full
              lead detail.
            </p>
          </div>
          <LeadKanban leads={[]} />
        </Card>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        All leads should include documented consent before agent outreach. Replacement eligibility
        subject to quality review.
      </p>
    </div>
  );
}

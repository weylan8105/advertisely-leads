import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LeadTable } from "@/components/leads/LeadTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { mockLeads } from "@/data/leads";

export default function LeadsPage() {
  const buckets = {
    all: mockLeads,
    new: mockLeads.filter((l) => l.status === "New"),
    contacted: mockLeads.filter((l) => l.status === "Contacted"),
    appointments: mockLeads.filter((l) => l.status === "Appointment Set"),
    closed: mockLeads.filter((l) => l.status === "Closed"),
  };

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Leads"
        description="Manage every IUL lead you've purchased — statuses, notes, agent assignments, and consent records all in one place."
        actions={
          <>
            <Link href="/marketplace">
              <Button size="sm" variant="outline">
                <PlusCircle className="h-4 w-4" />
                Order more leads
              </Button>
            </Link>
          </>
        }
      />

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

      <p className="mt-6 text-xs text-muted-foreground">
        All leads should include documented consent before agent outreach. Replacement eligibility
        subject to quality review.
      </p>
    </div>
  );
}

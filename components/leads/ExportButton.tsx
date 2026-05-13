"use client";
import { Download, FileSpreadsheet, Webhook, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ExportButtonProps {
  count?: number;
  variant?: "default" | "outline" | "subtle";
}

export function ExportButton({ count, variant = "outline" }: ExportButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm">
          <Download className="h-4 w-4" />
          Export{count !== undefined ? ` (${count})` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Export destination</DropdownMenuLabel>
        <DropdownMenuItem>
          <Download className="h-4 w-4 mr-2" />
          Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem>
          <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-300" />
          Send to Google Sheets
          <Check className="h-3 w-3 ml-auto text-emerald-400" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>CRM destinations</DropdownMenuLabel>
        <DropdownMenuItem>Push to GoHighLevel</DropdownMenuItem>
        <DropdownMenuItem>Push to Salesforce</DropdownMenuItem>
        <DropdownMenuItem>Push to HubSpot</DropdownMenuItem>
        <DropdownMenuItem>
          <Webhook className="h-4 w-4 mr-2" />
          Trigger custom webhook
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

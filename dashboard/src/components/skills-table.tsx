import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  CheckIcon,
  EyeIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SkillWithStatus } from "@/types";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      onClick={handleCopy}
      title={`Copy: ${command}`}
    >
      {copied ? (
        <CheckIcon className="size-3 text-green-500" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </Button>
  );
}

interface SkillsTableProps {
  data: SkillWithStatus[];
  onViewDetails: (skill: SkillWithStatus) => void;
  onInstall: (name: string) => void;
  onRemove: (name: string) => void;
}

export function SkillsTable({
  data,
  onViewDetails,
  onInstall,
  onRemove,
}: SkillsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  const columns: ColumnDef<SkillWithStatus>[] = React.useMemo(
    () => [
      {
        accessorKey: "displayName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Skill
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.displayName}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.name}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Category
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.getValue("category")}
          </span>
        ),
      },
      {
        id: "tags",
        accessorFn: (row) => row.tags.join(" "),
        header: "Tags",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {row.original.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0"
              >
                {tag}
              </Badge>
            ))}
            {row.original.tags.length > 3 && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
              >
                +{row.original.tags.length - 3}
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "installed",
        accessorFn: (row) => (row.installed ? "installed" : "not installed"),
        header: "Installed",
        cell: ({ row }) =>
          row.original.installed ? (
            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2Icon className="size-3.5" />
              Yes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <CircleDashedIcon className="size-3.5" />
              No
            </span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex justify-end gap-1">
              <CopyCommand command={`skills install ${s.name}`} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onViewDetails(s)}
              >
                <EyeIcon className="size-3.5" />
                Details
              </Button>
            </div>
          );
        },
      },
    ],
    [onViewDetails]
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: "includesString",
    initialState: {
      pagination: { pageSize: 20 },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search skills..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(!!value)
                  }
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    !row.original.installed ? "opacity-60" : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No skills found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()} ({table.getFilteredRowModel().rows.length}{" "}
          skill{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""})
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

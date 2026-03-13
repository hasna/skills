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
  type RowSelectionState,
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
  DownloadIcon,
  Loader2Icon,
  TrashIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  onBulkInstall: (names: string[]) => void;
  onBulkRemove: (names: string[]) => void;
  installingNames: Set<string>;
  removingNames: Set<string>;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onVisibleRowsChange: (skills: SkillWithStatus[], count: number) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function SkillsTable({
  data,
  onViewDetails,
  onInstall,
  onRemove,
  onBulkInstall,
  onBulkRemove,
  installingNames,
  removingNames,
  selectedIndex,
  onSelectedIndexChange,
  onVisibleRowsChange,
  searchInputRef,
}: SkillsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [categoryFilter, setCategoryFilter] = React.useState("");

  const categories = React.useMemo(() => {
    const cats = new Set(data.map((s) => s.category));
    return Array.from(cats).sort();
  }, [data]);

  // Apply category filter as a column filter
  React.useEffect(() => {
    if (categoryFilter) {
      setColumnFilters((prev) => {
        const without = prev.filter((f) => f.id !== "category");
        return [...without, { id: "category", value: categoryFilter }];
      });
    } else {
      setColumnFilters((prev) => prev.filter((f) => f.id !== "category"));
    }
  }, [categoryFilter]);

  const columns: ColumnDef<SkillWithStatus>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && false)
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
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
        filterFn: "equals",
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
          const isInstalling = installingNames.has(s.name);
          const isRemoving = removingNames.has(s.name);
          return (
            <div className="flex justify-end gap-1">
              <CopyCommand command={`skills install ${s.name}`} />
              {s.installed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(s.name)}
                  disabled={isRemoving}
                  className="text-destructive hover:text-destructive"
                >
                  {isRemoving ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <TrashIcon className="size-3.5" />
                  )}
                  {isRemoving ? "Removing..." : "Remove"}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onInstall(s.name)}
                  disabled={isInstalling}
                >
                  {isInstalling ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <DownloadIcon className="size-3.5" />
                  )}
                  {isInstalling ? "Installing..." : "Install"}
                </Button>
              )}
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
    [onViewDetails, onInstall, onRemove, installingNames, removingNames]
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: "includesString",
    enableRowSelection: true,
    initialState: {
      pagination: { pageSize: 20 },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      rowSelection,
    },
  });

  const selectedRows = React.useMemo(() => {
    return table.getSelectedRowModel().rows;
  }, [table, rowSelection]);

  const selectedNotInstalled = React.useMemo(() => {
    return selectedRows
      .filter((row) => !row.original.installed)
      .map((row) => row.original.name);
  }, [selectedRows]);

  const selectedInstalled = React.useMemo(() => {
    return selectedRows
      .filter((row) => row.original.installed)
      .map((row) => row.original.name);
  }, [selectedRows]);

  const totalSelected = selectedRows.length;

  function handleBulkInstall() {
    if (selectedNotInstalled.length > 0) {
      onBulkInstall(selectedNotInstalled);
      setRowSelection({});
    }
  }

  function handleBulkRemove() {
    if (selectedInstalled.length > 0) {
      onBulkRemove(selectedInstalled);
      setRowSelection({});
    }
  }

  function handleClearSelection() {
    setRowSelection({});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          ref={searchInputRef}
          placeholder="Search skills... (/)"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
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
              table.getRowModel().rows.map((row, rowIndex) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  data-keyboard-selected={rowIndex === selectedIndex ? "true" : undefined}
                  className={[
                    !row.original.installed ? "opacity-60" : "",
                    rowIndex === selectedIndex
                      ? "ring-2 ring-inset ring-primary/50 bg-primary/5"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  onClick={() => onSelectedIndexChange(rowIndex)}
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
          {Object.keys(rowSelection).length > 0 && (
            <span className="mr-3">
              {Object.keys(rowSelection).length} selected
            </span>
          )}
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

      {/* Floating bulk action bar — appears when rows are selected */}
      {totalSelected > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border bg-background/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
          <span className="text-sm font-medium text-muted-foreground mr-1">
            {totalSelected} selected
          </span>
          {selectedNotInstalled.length > 0 && (
            <Button
              size="sm"
              onClick={handleBulkInstall}
              disabled={selectedNotInstalled.some((n) => installingNames.has(n))}
            >
              {selectedNotInstalled.some((n) => installingNames.has(n)) ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              Install {selectedNotInstalled.length}
            </Button>
          )}
          {selectedInstalled.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkRemove}
              disabled={selectedInstalled.some((n) => removingNames.has(n))}
            >
              {selectedInstalled.some((n) => removingNames.has(n)) ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <TrashIcon className="size-3.5" />
              )}
              Remove {selectedInstalled.length}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClearSelection}
          >
            <XIcon className="size-3.5" />
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

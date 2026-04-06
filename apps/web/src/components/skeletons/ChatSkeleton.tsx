import { Skeleton } from "@/components/ui/skeleton";

const MESSAGES = [
  { align: "left" as const, width: "65%" },
  { align: "right" as const, width: "45%" },
  { align: "left" as const, width: "55%" },
  { align: "right" as const, width: "35%" },
  { align: "left" as const, width: "70%" },
];

export function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 space-y-4 p-4">
        {MESSAGES.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.align === "right" ? "justify-end" : "justify-start"}`}
          >
            <Skeleton
              className="h-10 rounded-lg"
              style={{ width: msg.width }}
            />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-4">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

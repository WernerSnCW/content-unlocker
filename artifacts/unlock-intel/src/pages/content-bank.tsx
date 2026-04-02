import { useGetContentBank } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search, BookOpen, Quote, ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";

export default function ContentBank() {
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const { data: bank, isLoading } = useGetContentBank({ search });

  const toggleSection = (index: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!bank?.sections) return;
    setExpandedSections(new Set(bank.sections.map((_, i) => i)));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Content Bank</h1>
          <p className="text-muted-foreground mt-1">Approved messaging, positioning, and source material.</p>
        </div>
        <div className="flex gap-2 mt-1">
          <button onClick={expandAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted">
            Expand all
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button onClick={collapseAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted">
            Collapse all
          </button>
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="Search content bank..."
          className="pl-10 py-6 text-lg bg-card shadow-sm border-muted-foreground/20"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="text-sm text-muted-foreground">
        {bank?.sections ? `${bank.sections.length} sections` : ""}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array(5).fill(0).map((_, i) => (
            <Card key={i}>
              <CardHeader className="py-4">
                <Skeleton className="h-5 w-48" />
              </CardHeader>
            </Card>
          ))
        ) : bank?.sections.length === 0 ? (
          <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No content found matching "{search}"</p>
          </div>
        ) : (
          bank?.sections.map((section, index) => {
            const isExpanded = expandedSections.has(index);
            return (
              <Card key={index} className="overflow-hidden transition-shadow hover:shadow-md">
                <button
                  className="w-full text-left"
                  onClick={() => toggleSection(index)}
                >
                  <CardHeader className="py-4 flex flex-row items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Quote className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      {section.title}
                    </CardTitle>
                    {!isExpanded && (
                      <span className="text-xs text-muted-foreground ml-auto truncate max-w-[300px]">
                        {section.content.slice(0, 80).replace(/[*#\-_]/g, '').trim()}…
                      </span>
                    )}
                  </CardHeader>
                </button>
                {isExpanded && (
                  <CardContent className="pt-0 pb-6 px-12">
                    <div className="prose prose-sm max-w-none dark:prose-invert
                      prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-6 prose-headings:mb-2
                      prose-p:text-foreground/85 prose-p:leading-relaxed prose-p:my-2
                      prose-strong:text-foreground prose-strong:font-semibold
                      prose-li:text-foreground/85 prose-li:my-0.5
                      prose-ul:my-2 prose-ol:my-2
                      prose-hr:border-border prose-hr:my-6
                      prose-table:text-sm prose-th:text-left prose-th:font-semibold prose-th:pb-2 prose-th:border-b
                      prose-td:py-1.5 prose-td:pr-4
                    ">
                      <ReactMarkdown>{section.content}</ReactMarkdown>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

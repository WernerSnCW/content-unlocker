import { useGetContentBank } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search, BookOpen, Quote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ContentBank() {
  const [search, setSearch] = useState("");
  const { data: bank, isLoading } = useGetContentBank({ search });

  const highlightText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === highlight.toLowerCase() ? 
        <span key={i} className="bg-primary/20 text-primary font-medium rounded px-1">{part}</span> : part
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Content Bank</h1>
        <p className="text-muted-foreground mt-1">Approved messaging, positioning, and source material.</p>
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

      <div className="space-y-8">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[95%]" />
              </CardContent>
            </Card>
          ))
        ) : bank?.sections.length === 0 ? (
          <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
            <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>No content found matching "{search}"</p>
          </div>
        ) : (
          bank?.sections.map((section, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Quote className="w-4 h-4 text-primary" />
                  {highlightText(section.title, search)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="prose prose-sm max-w-none text-foreground/90 whitespace-pre-wrap">
                  {highlightText(section.content, search)}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

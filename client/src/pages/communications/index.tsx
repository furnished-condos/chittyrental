
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import type { Property } from "@shared/schema";

export default function CommunicationsPage() {
  const [message, setMessage] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<string>();
  const [targetLanguage, setTargetLanguage] = useState<string>();

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const sendNotification = async () => {
    await fetch("/api/communications/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: selectedProperty ? Number(selectedProperty) : undefined,
        message,
        translateTo: targetLanguage
      }),
    });
    setMessage("");
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Communications</h1>
        
        <Card>
          <CardHeader>
            <CardTitle>Send Mass Notification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={selectedProperty}
              onValueChange={setSelectedProperty}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Property" />
              </SelectTrigger>
              <SelectContent>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id.toString()}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={targetLanguage}
              onValueChange={setTargetLanguage}
            >
              <SelectTrigger>
                <SelectValue placeholder="Target Language (Optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="zh">Chinese</SelectItem>
                <SelectItem value="pl">Polish</SelectItem>
              </SelectContent>
            </Select>

            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message..."
              rows={4}
            />

            <Button onClick={sendNotification}>
              Send Notification
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

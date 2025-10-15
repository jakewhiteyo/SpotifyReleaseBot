import { useState, useEffect } from "react";
import Head from "next/head";

interface ApiResponse {
  message: string;
  timestamp: string;
}

export default function Home() {
  const [apiData, setApiData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const testApi = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/hello");
      const data: ApiResponse = await response.json();
      setApiData(data);
    } catch (error) {
      console.error("Error fetching API:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Spotify Release Bot</title>
        <meta name="description" content="Serverless Spotify Release Bot" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>Spotify Release Bot</h1>
        <p>Your serverless Next.js application with TypeScript is ready!</p>

        <div style={{ marginTop: "2rem" }}>
          <button
            onClick={testApi}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Testing..." : "Test API"}
          </button>

          {apiData && (
            <div
              style={{
                marginTop: "1rem",
                padding: "1rem",
                backgroundColor: "#f0f0f0",
                borderRadius: "4px",
              }}
            >
              <h3>API Response:</h3>
              <p>
                <strong>Message:</strong> {apiData.message}
              </p>
              <p>
                <strong>Timestamp:</strong> {apiData.timestamp}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

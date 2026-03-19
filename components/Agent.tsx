"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { INTERVIEW_SYSTEM_PROMPT } from "@/prompts/interviewSystemPrompt";

type Message = { role: "user" | "ai"; content: string };
type CallStatus = "inactive" | "active" | "finished";

type BrowserSpeechRecognition = typeof window.SpeechRecognition extends new () => infer R
  ? R
  : InstanceType<typeof window.webkitSpeechRecognition>;

type SpeechRecognitionAlternativeLike = {
  transcript?: string;
};

type SpeechRecognitionResultLike = {
  0?: SpeechRecognitionAlternativeLike;
  isFinal?: boolean;
};

type RecognitionResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type RecognitionErrorEvent = Event & {
  error?: string;
};

const Agent = ({ userName, userId, interviewId, type }: AgentProps) => {
  const router = useRouter();

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [interviewStep, setInterviewStep] = useState(0);
  const [callStatus, setCallStatus] = useState<CallStatus>("inactive");
  const [micDenied, setMicDenied] = useState(false);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const isSpeakingRef = useRef(false);
  const isLoadingRef = useRef(false);
  const callStatusRef = useRef<CallStatus>("inactive");
  const interviewStepRef = useRef(0);
  const feedbackRequestedRef = useRef(false);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      // noop
    }
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    if (callStatusRef.current !== "active") return;
    if (isSpeakingRef.current || isLoadingRef.current) return;
    if (micDenied) return;

    const recognizer = recognitionRef.current;
    if (!recognizer) return;

    try {
      recognizer.start();
    } catch {
      // Swallow "already started" browser errors.
    }
  }, [micDenied]);

  const callGemini = useCallback(async (msgs: Message[], prompt: string) => {
    if (!msgs || msgs.length === 0) {
      console.error("callGemini called with empty messages");
      return "";
    }

    const dedupedMessages = msgs.reduce<Message[]>((acc, curr) => {
      if (acc.length === 0) return [curr];

      const last = acc[acc.length - 1];
      if (last.role === curr.role) {
        return [...acc.slice(0, -1), curr];
      }

      return [...acc, curr];
    }, []);

    const validMessages =
      dedupedMessages[0]?.role === "user"
        ? dedupedMessages
        : dedupedMessages.slice(1);

    if (!validMessages.length) {
      console.error("No valid alternating messages to send to Gemini");
      return "";
    }

    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: validMessages.slice(-10),
        systemPrompt: prompt,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      response?: string;
    };

    if (!res.ok || data.error) {
      toast.error(data.error || "AI response failed. Please try again.");
      setIsLoading(false);
      isLoadingRef.current = false;
      return "";
    }

    if (!data.response || data.response.trim() === "") {
      toast.error("AI returned empty response. Retrying...");
      setIsLoading(false);
      isLoadingRef.current = false;
      return "";
    }

    return data.response.trim();
  }, []);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      const next = [...prev, message];
      messagesRef.current = next;
      return next;
    });
  }, []);

  const speakText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      stopListening();
      window.speechSynthesis.cancel();

      await new Promise((resolve) => setTimeout(resolve, 300));

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1;
      utterance.pitch = 1;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((voice) => voice.lang.toLowerCase().startsWith("en") && /google|samantha|zira|david/i.test(voice.name)) ||
        voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));

      if (preferredVoice) utterance.voice = preferredVoice;

      utterance.onstart = () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        stopListening();
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;

        setTimeout(() => {
          if (callStatusRef.current === "active" && !isLoadingRef.current) {
            startListening();
          }
        }, 500);
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        toast.error("Unable to play AI voice response.");
      };

      window.speechSynthesis.speak(utterance);
    },
    [startListening, stopListening]
  );

  const finalizeInterview = useCallback(() => {
    setCallStatus("finished");
    callStatusRef.current = "finished";
    stopListening();
    window.speechSynthesis.cancel();
  }, [stopListening]);

  const runAiTurn = useCallback(
    async (history: Message[], overrideInstruction?: string) => {
      setIsLoading(true);
      isLoadingRef.current = true;

      try {
        const response = await callGemini(
          history,
          overrideInstruction || INTERVIEW_SYSTEM_PROMPT
        );

        if (!response.trim()) return;

        const aiMessage: Message = { role: "ai", content: response };
        const nextMessages = [...history, aiMessage];

        setMessages(nextMessages);
        messagesRef.current = nextMessages;

        setInterviewStep((prev) => {
          const next = prev + 1;
          interviewStepRef.current = next;
          return next;
        });

        await speakText(response);

        if (interviewStepRef.current >= 6) {
          const closingInstruction =
            "You are ending the mock interview now. Give brief closing remarks, thank the candidate, and mention feedback will be generated. Keep it under 3 sentences.";
          const closingResponse = await callGemini(nextMessages, closingInstruction);

          if (!closingResponse.trim()) {
            finalizeInterview();
            return;
          }

          const closingMessage: Message = { role: "ai", content: closingResponse };
          const finalMessages = [...nextMessages, closingMessage];

          setMessages(finalMessages);
          messagesRef.current = finalMessages;
          await speakText(closingResponse);
          finalizeInterview();
        }
      } catch (error) {
        console.error("AI interview turn failed:", error);
        toast.error("Failed to get interviewer response. Please try again.");
      } finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    },
    [callGemini, finalizeInterview, speakText]
  );

  const generateInterviewFromPrompt = useCallback(
    async (promptText: string) => {
      const response = await fetch("/api/interview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "Mixed",
          role: promptText || "Software Engineer",
          level: "Mid",
          techstack: "JavaScript,TypeScript,React",
          amount: 5,
          userid: userId,
        }),
      });

      if (!response.ok) throw new Error("Failed to generate interview.");
    },
    [userId]
  );

  const submitCurrentTranscript = useCallback(async () => {
    const content = transcriptRef.current.trim();
    if (!content) return;

    stopListening();
    setTranscript("");
    transcriptRef.current = "";

    const userMessage: Message = { role: "user", content };
    appendMessage(userMessage);

    if (type === "generate") {
      try {
        setIsLoading(true);
        isLoadingRef.current = true;
        await generateInterviewFromPrompt(content);
        toast.success("Interview generated successfully.");
        finalizeInterview();
        router.push("/");
      } catch (error) {
        console.error("Generate interview failed:", error);
        toast.error("Unable to generate interview.");
      } finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
      return;
    }

    await runAiTurn([...messagesRef.current, userMessage]);
  }, [
    appendMessage,
    finalizeInterview,
    generateInterviewFromPrompt,
    router,
    runAiTurn,
    stopListening,
    type,
  ]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    const recognizer = new SpeechRecognitionCtor();
    recognitionRef.current = recognizer;

    recognizer.lang = "en-US";
    recognizer.continuous = false;
    recognizer.interimResults = true;

    recognizer.onstart = () => {
      setIsListening(true);
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        if (transcriptRef.current.trim()) {
          void submitCurrentTranscript();
        }
      }, 2500);
    };

    recognizer.onresult = (event: Event) => {
      const speechEvent = event as RecognitionResultEvent;
      const chunks: string[] = [];

      for (let index = speechEvent.resultIndex; index < speechEvent.results.length; index += 1) {
        const part = speechEvent.results[index]?.[0]?.transcript?.trim();
        if (part) chunks.push(part);
      }

      const nextText = chunks.join(" ").trim();
      setTranscript(nextText);
      transcriptRef.current = nextText;
    };

    recognizer.onend = () => {
      setIsListening(false);
      clearSilenceTimer();

      if (
        callStatusRef.current === "active" &&
        !isSpeakingRef.current &&
        !isLoadingRef.current
      ) {
        if (transcriptRef.current.trim()) {
          void submitCurrentTranscript();
        } else {
          setTimeout(() => startListening(), 350);
        }
      }
    };

    recognizer.onerror = (event: Event) => {
      const errorEvent = event as RecognitionErrorEvent;
      setIsListening(false);
      clearSilenceTimer();

      if (errorEvent.error === "not-allowed") {
        setMicDenied(true);
        toast.error("Microphone access denied");
        return;
      }

      if (errorEvent.error === "no-speech") {
        if (callStatusRef.current === "active" && !isSpeakingRef.current && !isLoadingRef.current) {
          setTimeout(() => startListening(), 350);
        }
        return;
      }

      console.error("Speech recognition error:", errorEvent.error);
      toast.error("Speech recognition error. Please try again.");
    };

    return () => {
      clearSilenceTimer();
      try {
        recognizer.stop();
      } catch {
        // noop
      }
      recognitionRef.current = null;
      window.speechSynthesis.cancel();
    };
  }, [clearSilenceTimer, startListening, submitCurrentTranscript]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    interviewStepRef.current = interviewStep;
  }, [interviewStep]);

  useEffect(() => {
    if (callStatus !== "finished") return;
    if (type !== "interview") return;
    if (!interviewId) return;
    if (feedbackRequestedRef.current) return;

    feedbackRequestedRef.current = true;

    const submitFeedback = async () => {
      try {
        toast.loading("Generating feedback...", { id: "feedback-progress" });
        const response = await fetch("/api/interview/generate-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messagesRef.current,
            interviewId,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || "Failed to generate feedback.");
        }

        toast.success("Feedback ready.", { id: "feedback-progress" });
        router.push(`/interview/${interviewId}/feedback`);
      } catch (error) {
        console.error("Generate feedback failed:", error);
        toast.error("Failed to generate feedback.", { id: "feedback-progress" });
      }
    };

    void submitFeedback();
  }, [callStatus, interviewId, router, type]);

  const handleStartInterview = async () => {
    if (callStatus !== "inactive") return;

    feedbackRequestedRef.current = false;
    setMessages([]);
    messagesRef.current = [];
    setInterviewStep(0);
    interviewStepRef.current = 0;
    setTranscript("");
    transcriptRef.current = "";

    setCallStatus("active");
    callStatusRef.current = "active";

    try {
      if (type === "generate") {
        const intro =
          "Describe the interview you want to generate in one sentence, including role and technologies.";
        appendMessage({ role: "ai", content: intro });
        await speakText(intro);
        startListening();
        return;
      }

      setIsLoading(true);
      isLoadingRef.current = true;
      const initialMessage: Message = {
        role: "user",
        content:
          "Start the interview. Introduce yourself briefly and ask the first question.",
      };

      setMessages([initialMessage]);
      messagesRef.current = [initialMessage];

      const opening = await callGemini(
        [initialMessage],
        `${INTERVIEW_SYSTEM_PROMPT} Start the interview with a brief introduction and first question.`
      );

      if (!opening.trim()) {
        throw new Error("AI returned empty response.");
      }

      const openingMessage: Message = { role: "ai", content: opening };
      setMessages([openingMessage]);
      messagesRef.current = [openingMessage];
      setInterviewStep(1);
      interviewStepRef.current = 1;
      await speakText(opening);
      startListening();
    } catch (error) {
      console.error("Failed to start interview:", error);
      toast.error("Unable to start interview.");
      setCallStatus("inactive");
      callStatusRef.current = "inactive";
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  };

  const handleEndInterview = () => {
    if (callStatus !== "active") return;
    finalizeInterview();
  };

  const statusText =
    callStatus === "finished"
      ? "Interview ended"
      : isLoading
        ? "Processing..."
        : isSpeaking
          ? "AI is speaking..."
          : isListening
            ? "Listening..."
            : "Interview active";

  return (
    <>
      {micDenied && (
        <div className="w-full rounded-xl border border-destructive-100 bg-destructive-100/15 px-4 py-3 text-sm text-white">
          Microphone access denied. Enable microphone permissions in Chrome and reload.
        </div>
      )}

      <div className="call-view">
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="AI interviewer"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="Candidate"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      <div className="card-border w-full">
        <div className="card-content items-stretch">
          <div className="rounded-xl bg-dark-200 px-4 py-3 text-center text-sm font-semibold text-primary-100">
            {statusText}
          </div>

          <div className="rounded-xl bg-dark-200 px-4 py-3 text-sm text-light-100">
            <p className="mb-1 text-xs uppercase tracking-wide opacity-70">Live Transcript</p>
            <p>{transcript || "Start speaking to see your live transcript..."}</p>
          </div>

          <div className="rounded-xl bg-dark-200 px-2 py-2">
            <div className="max-h-80 overflow-y-auto space-y-2 px-2">
              {messages.length === 0 ? (
                <p className="text-sm text-light-100">Conversation will appear here once interview starts.</p>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn(
                      "max-w-[85%] rounded-xl px-4 py-3 text-sm",
                      message.role === "user"
                        ? "ml-auto bg-primary-200 text-dark-100"
                        : "mr-auto bg-light-800 text-light-100"
                    )}
                  >
                    <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
                      {message.role === "user" ? userName : "AI"}
                    </p>
                    <p>{message.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full flex justify-center gap-4 flex-wrap">
        {callStatus === "inactive" && (
          <button className="btn-call" onClick={handleStartInterview} disabled={isLoading}>
            Start Interview
          </button>
        )}

        {callStatus === "active" && (
          <button className="btn-disconnect" onClick={handleEndInterview}>
            End Interview
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;

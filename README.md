# AI Mock Interview

## Overview
AI Mock Interview is a Next.js application that simulates technical interviews using voice interaction and Google Gemini.
Users can create interview sessions, answer questions out loud, and receive structured feedback with category-based scoring.

Key features:
- Email/password authentication with Firebase Auth
- AI-generated interview questions and live interview flow
- Browser-based voice input with Web Speech API (speech recognition)
- Browser text-to-speech for AI interviewer responses
- Interview history dashboard (your interviews + latest available interviews)
- Automatic post-interview feedback generation with scores and improvement areas
- Firestore persistence for users, interviews, and feedback

## Tech Stack
- Next.js 15 (App Router): full-stack framework for pages, API routes, and server rendering
- React 19 + TypeScript: UI and type-safe client/server logic
- Firebase Auth (Client + Admin): authentication, session handling, user identity
- Firestore (Admin SDK): interview and feedback storage
- Google Gemini API via @google/generative-ai: question generation, interview responses, and feedback analysis
- Web Speech API: microphone speech-to-text in the browser
- SpeechSynthesis API: AI voice playback in the browser
- Tailwind CSS 4: styling and responsive layout
- react-hook-form + zod: form handling and validation
- Sonner: toast notifications

## Prerequisites
- Node.js: 20 LTS recommended (18.18+ minimum for Next.js 15)
- npm: comes with Node.js
- Google Chrome: required for the most reliable Web Speech API behavior
- Firebase project: for Auth + Firestore
- Google AI Studio account: for Gemini API key

## Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/tanishqojha/AI-Interviewer.git
cd ai_mock_interviews-main
```

### 2. Install dependencies
```bash
npm install
```

### 3. Firebase Setup
1. Create a Firebase project at https://console.firebase.google.com.
2. Enable Authentication:
	 - Go to Authentication > Sign-in method
	 - Enable Email/Password
3. Enable Firestore Database:
	 - Go to Firestore Database > Create database
	 - Start in production mode (recommended)
4. Create a Web App:
	 - Go to Project settings > General > Your apps > Web app
	 - Copy the Firebase web config values
5. Generate a service account key:
	 - Go to Project settings > Service accounts
	 - Generate new private key
	 - Use project_id, client_email, and private_key in environment variables
6. Set Firestore Rules:
	 - Go to Firestore Database > Rules
	 - Paste this exact ruleset:

```txt
rules_version = '2';

service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId} {
			allow create, read, update, delete: if request.auth != null && request.auth.uid == userId;
		}

		match /interviews/{interviewId} {
			allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
			allow read, update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
		}

		match /feedback/{feedbackId} {
			allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
			allow read, update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
		}

		match /{document=**} {
			allow read, write: if false;
		}
	}
}
```

7. Create required Firestore composite indexes:
	 - Firestore Database > Indexes > Composite
	 - Add these two indexes:

```txt
Collection ID: interviews
Fields:
- userId (Ascending)
- createdAt (Descending)

Collection ID: interviews
Fields:
- finalized (Ascending)
- createdAt (Descending)
- userId (Ascending)
```

### 4. Google Gemini Setup
1. Open https://aistudio.google.com.
2. Create an API key.
3. Add the key to GOOGLE_GENERATIVE_AI_API_KEY in .env.local.
4. Free tier notes:
	 - Request limits and token limits apply
	 - Limits vary by model and can change over time
	 - If you see rate-limit or quota errors, wait and retry or upgrade quota in Google AI Studio

### 5. Environment Variables
Create a .env.local file in the project root and set:

```env
GOOGLE_GENERATIVE_AI_API_KEY=

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Variable descriptions:
- GOOGLE_GENERATIVE_AI_API_KEY: API key from Google AI Studio
- FIREBASE_PROJECT_ID: Firebase project ID for Admin SDK
- FIREBASE_CLIENT_EMAIL: service account client email
- FIREBASE_PRIVATE_KEY: service account private key (keep escaped newlines in env file)
- NEXT_PUBLIC_FIREBASE_API_KEY: web app Firebase API key
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: Firebase Auth domain (example: your-project.firebaseapp.com)
- NEXT_PUBLIC_FIREBASE_PROJECT_ID: Firebase project ID for client SDK
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: Firebase storage bucket
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: Firebase sender ID
- NEXT_PUBLIC_FIREBASE_APP_ID: Firebase web app ID

### 6. Run the development server
```bash
npm run dev
```

Then open http://localhost:3000.

## How to Use
1. Sign up / Sign in:
	 - Create an account with email/password or sign in with existing credentials.

2. Generate an interview:
	 - Open Interview generation page.
	 - Fill the form fields:
		 - Role: target role (for example Frontend Engineer)
		 - Level: experience level (Junior, Mid, Senior)
		 - Type: interview focus (for example technical/behavioral/mixed)
		 - Tech stack: comma-separated technologies
		 - Number of questions (amount): how many questions to generate
	 - Submit to create an interview record.

3. Take the voice interview:
	 - Start interview to begin the AI voice flow.
	 - Grant microphone permission in Chrome.
	 - The app listens to your speech, transcribes it, sends the transcript to Gemini, and reads AI responses aloud.
	 - The cycle repeats until interview completion.

4. View feedback:
	 - After interview ends, feedback is generated automatically.
	 - Open the feedback page to see:
		 - Total score
		 - Category-wise scores and comments
		 - Strengths
		 - Areas for improvement
		 - Final assessment

## Project Structure
- app: App Router pages, layouts, and API routes
	- app/(auth): sign-in and sign-up pages
	- app/(root): dashboard, interview pages, feedback page
	- app/api/gemini: Gemini chat API for interview conversation
	- app/api/interview/generate: interview question generation API
	- app/api/interview/generate-feedback: post-interview feedback generation API
- components: reusable UI and feature components
	- components/Agent.tsx: voice interview engine (speech recognition + TTS + AI turn loop)
	- components/InterviewGenerateForm.tsx: interview creation form
	- components/ui: shared UI primitives
- constants: constants and zod schema definitions
- firebase
	- firebase/client.ts: Firebase client SDK initialization
	- firebase/admin.ts: Firebase Admin SDK initialization
- lib
	- lib/actions: server actions for auth and interview/feedback data
	- lib/utils.ts: utility helpers
- public: static assets (images/covers)
- types: shared TypeScript declarations
- firestore.indexes.json: Firestore composite index definitions

## Known Limitations
- Best experience is Chrome due to Web Speech API behavior differences across browsers
- Gemini free tier quotas can cause rate-limit or temporary failure responses
- Microphone permission is mandatory for voice interview flow

## Deployment (Vercel)
1. Push code to GitHub/GitLab/Bitbucket.
2. Go to https://vercel.com and import the repository.
3. In Project Settings > Environment Variables, add all variables from .env.local.
4. Deploy.
5. After deployment, verify:
	 - Auth domain and redirect URLs in Firebase
	 - Firestore indexes are created
	 - Gemini API key is present in Vercel environment settings

How to add env vars in Vercel:
- Open your Vercel project
- Go to Settings > Environment Variables
- Add each key/value pair
- Select environments (Development, Preview, Production)
- Redeploy after changes

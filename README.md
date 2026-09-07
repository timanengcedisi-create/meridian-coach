# Meridian Coach Operations

One folder. One app. One npm start.

Includes:
- Whole-coach charter booking (select coaches; capacity = coaches x 65)
- Multi-coach bookings under one reference
- Operations overview, trips, passengers, lost luggage, service desk, queue, audit
- AI Agent Manager for the Vapi voice agent

The voice platform name is Vapi (V-A-P-I), not Vapia, Vapier, or Vapir.

## Run

cd meridian-coach
npm install
npm start

Open http://localhost:3000

AI Agent Manager PIN: 2468

Vapi prompt feed:
GET /api/voice-agent/instructions
X-Voice-Key: meridian-voice-local


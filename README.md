# SiteVision

Browse construction sites in 360° — from floor plans and photo captures to published walkthroughs you can share and revisit anytime.

*by SiteSureLabs*

---

## Who it’s for

| Role | What you do |
| --- | --- |
| **Engineer** | Upload floor plans, place pins, capture rooms, and publish walkthroughs |
| **Manager** | Review published tours and track project progress |
| **Admin** | Manage projects, media, and users across the organization |

---

## Getting started

1. **Sign in** with your account.
2. Open your **project**, then the right **tower** and **floor**.
3. Follow the flow below for your role.

---

## Typical workflow

### 1. Floor plans
Upload a floor plan for a floor, then place **capture pins** where photos should be taken.

### 2. Captures
At each pin, upload 360° (or site) photos. Newer captures on the same pin become the latest stop in the tour.

### 3. Publish a walkthrough
When pins have captures, **publish** the floor as a Virtual Tour. That creates a sequential walkthrough (Pin 1 → Pin 2 → …).

### 4. Virtual Tours
Open **Virtual Tours** to browse published walkthroughs.

- Pick a **project** (or All projects) to browse.
- Use **tower** and **floor** filters to narrow the list.
- Open a tour to step through each pin in 360°.

### 5. Favorites
Tap the **star** on any tour card to save it.

- Open the **Favorites** tab to see only your starred tours.
- Favorites are personal to your account.
- They show across projects — location filters do not hide them.

---

## Tips

- Only **published** floor walkthroughs appear in Virtual Tours.
- If a tour is missing after publish, refresh the page, then check you’re on the right project (or switch to Favorites / All projects).
- Deleting a tour removes it from the list; the underlying captures and pins stay so you can republish later.
- Un-star a tour anytime by tapping the star again.

---

## Share on your network (same Wi‑Fi / office LAN)

Others on your network can use the app by opening your machine’s IP in a browser.

### On your computer

1. **Start the backend** (listens on all interfaces):

```bash
cd backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
```

2. **Start the frontend** (exposes a Network URL):

```bash
cd frontend
npm run dev
```

Vite will print something like:

- Local: `http://localhost:5173/`
- Network: `http://172.20.7.22:5173/` ← share this one

3. If Windows Firewall asks, **allow access** on ports **5173** and **8002** (Private networks).

### Share with teammates

Send them the **Network** URL, for example:

`http://172.20.7.22:5173`

They must be on the **same Wi‑Fi / network** as you. Keep both servers running while they use it.

### Find your IP again

In PowerShell:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '172.*' -or $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' }
```

Use the Ethernet / Wi‑Fi address (not `vEthernet` / WSL unless that’s intentional).

---

## Need help?

If something looks wrong (empty list, missing favorite, tour won’t open), try a refresh first. If it still fails, contact your admin with the project name and floor.

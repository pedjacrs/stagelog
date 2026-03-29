# TM Time Manager — Vodič za Postavljanje
*Studio Seven · Windows Server*

---

## ŠTO ĆEŠ DOBITI

- Web aplikacija dostupna svima na internetu
- Login sistem s ulogama (Admin / Manager / Viewer)
- PostgreSQL baza podataka na tvom računaru
- HTTPS tunel putem Cloudflare (besplatno, bez statičnog IP)

---

## KORAK 1 — Instaliraj Node.js

1. Idi na https://nodejs.org
2. Preuzmi **LTS** verziju (zeleno dugme)
3. Instaliraj sa zadanim postavkama (klikaj Next)
4. Provjeri instalaciju: otvori **Command Prompt** i ukucaj:
   ```
   node --version
   npm --version
   ```
   Oba trebaju ispisati verziju (npr. v20.x.x)

---

## KORAK 2 — Instaliraj PostgreSQL

1. Idi na https://www.postgresql.org/download/windows/
2. Preuzmi PostgreSQL 16 (ili noviji)
3. Tokom instalacije:
   - **Password**: Zapamti ovu lozinku (to je lozinka za postgres superusera)
   - **Port**: Ostavi 5432
   - **Stack Builder**: Možeš preskočiti
4. Nakon instalacije otvori **pgAdmin** (instalira se automatski)

### Kreiraj bazu i korisnika u pgAdmin:

Otvori **pgAdmin** → desni klik na "Servers" → "Query Tool" pa izvrši:

```sql
-- Kreiraj korisnika za aplikaciju
CREATE USER tm_user WITH PASSWORD 'TVOJA_LOZINKA_OVDJE';

-- Kreiraj bazu
CREATE DATABASE timemanager OWNER tm_user;

-- Daj ovlasti
GRANT ALL PRIVILEGES ON DATABASE timemanager TO tm_user;
```

> ⚠️ Promijeni `TVOJA_LOZINKA_OVDJE` u nešto sigurno!

---

## KORAK 3 — Postavi Aplikaciju

1. Raspakiraj `timemanager` folder na npr. `C:\timemanager\`

2. Otvori **Command Prompt kao Administrator**, idi u folder:
   ```
   cd C:\timemanager
   ```

3. Instaliraj npm pakete:
   ```
   npm install
   ```

4. Kopiraj `.env.example` u `.env`:
   ```
   copy .env.example .env
   ```

5. Otvori `.env` u Notepadu i popuni:
   ```
   DB_PASSWORD=TVOJA_LOZINKA (ista kao u pgAdmin koraku iznad)
   JWT_SECRET=neki-dug-random-string-minimalno-32-znaka-npr-abc123xyz789def456
   ADMIN_EMAIL=tvoj@email.com
   ADMIN_PASSWORD=SigurnaLozinka123!
   ADMIN_NAME=Tvoje Ime
   ```

6. Pokreni setup baze (kreira sve tabele + admin nalog):
   ```
   npm run setup-db
   ```
   Trebaš vidjeti: `✅ Tabele kreirane.` i `✅ Admin kreiran.`

7. Pokreni server:
   ```
   npm start
   ```
   Trebaš vidjeti: `✅ TM Time Manager pokrenut! → http://localhost:3000`

8. Otvori browser na http://localhost:3000 i prijavi se s admin kredencijalima.

---

## KORAK 4 — Cloudflare Tunnel (Internet Pristup)

Ovo omogućava korisnicima da pristupe s interneta BEZ potrebe za statičnim IP ili router konfiguracijom.

### 4a — Kreiraj besplatni Cloudflare nalog
1. Idi na https://cloudflare.com → Sign Up (besplatno)
2. Potvri email

### 4b — Instaliraj cloudflared
1. Idi na https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Preuzmi `cloudflared-windows-amd64.msi`
3. Instaliraj

### 4c — Postavi tunel
Otvori novi Command Prompt i uradi:

```cmd
REM Prijavi se u Cloudflare
cloudflared tunnel login

REM Kreiraj tunel (daj mu ime, npr. timemanager)
cloudflared tunnel create timemanager

REM Kreiraj config fajl
REM Ovo će ispisati UUID tunela, zapamti ga!
```

Kreiraj fajl `C:\Users\TVOJE_IME\.cloudflared\config.yml`:
```yaml
tunnel: OVDJE-STAVI-UUID-TUNELA
credentials-file: C:\Users\TVOJE_IME\.cloudflared\OVDJE-UUID.json

ingress:
  - service: http://localhost:3000
```

```cmd
REM Radi tunel
cloudflared tunnel run timemanager
```

Dobiješ URL tipa: `https://timemanager.randomstring.cfargotunnel.com`

### 4d — Vlastiti subdomain (opcionalno)
Ako ne želiš nasumični URL, u Cloudflare dashboard dodaj CNAME:
```
timemanager.tvrtka.com → tvoj-tunel-uuid.cfargotunnel.com
```

---

## KORAK 5 — Automatski Start (Windows Service)

Da server radi automatski kad se računar uključi:

1. Instaliraj `pm2`:
   ```
   npm install -g pm2
   npm install -g pm2-windows-startup
   ```

2. Pokreni aplikaciju kroz pm2:
   ```
   cd C:\timemanager
   pm2 start server.js --name timemanager
   pm2 save
   pm2-startup install
   ```

3. Za Cloudflare tunel, kreiraj Windows Task Scheduler task koji pokreće:
   ```
   cloudflared tunnel run timemanager
   ```
   pri startu računara (Task Scheduler → Create Basic Task → At startup)

---

## UPRAVLJANJE KORISNICIMA

### Dodaj novog korisnika:
1. Prijavi se kao Admin
2. Idi na **Korisnici** (sidebar, vidljivo samo adminu)
3. Klikni "+ Novi Korisnik"
4. Odaberi ulogu:
   - **Admin** — sve ovlasti
   - **Manager** — dodavanje projekata, zaposlenika, logovanje vremena
   - **Viewer** — samo pregled, bez izmjena

### Uloge — šta ko može:
| Funkcija | Viewer | Manager | Admin |
|----------|--------|---------|-------|
| Pregled svega | ✅ | ✅ | ✅ |
| Log vremena | ❌ | ✅ | ✅ |
| Dodaj projekt | ❌ | ✅ | ✅ |
| Dodaj zaposlenika | ❌ | ✅ | ✅ |
| Odobri unose | ❌ | ✅ | ✅ |
| Upravljaj korisnicima | ❌ | ❌ | ✅ |
| Briši podatke | ❌ | ❌ | ✅ |

---

## BACKUP

Svakodnevni backup baze (preporučeno):

Kreiraj `backup.bat`:
```bat
@echo off
set PGPASSWORD=TVOJA_DB_LOZINKA
set DATE=%date:~6,4%-%date:~3,2%-%date:~0,2%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U tm_user timemanager > C:\backups\tm_%DATE%.sql
echo Backup done: %DATE%
```

Dodaj u Task Scheduler da se izvršava svake noći u 02:00.

---

## API Endpointi

Sve rute osim `/api/auth/login` zahtijevaju JWT token (automatski u cookie-ju).

| Method | Ruta | Opis |
|--------|------|------|
| POST | `/api/auth/login` | Prijava |
| GET | `/api/auth/me` | Trenutni korisnik |
| GET | `/api/projects` | Lista projekata |
| POST | `/api/projects` | Novi projekt |
| GET | `/api/employees` | Lista zaposlenika |
| POST | `/api/time-entries` | Log vremena |
| GET | `/api/time-entries` | Unosi (s filterima) |
| PATCH | `/api/time-entries/:id/approve` | Odobrenje unosa |
| GET | `/api/pull-sheet` | Pull sheet izvještaj |
| GET | `/api/equipment` | Lista opreme |
| GET | `/api/dashboard/stats` | Dashboard statistike |
| GET | `/api/auth/users` | Korisnici (Admin) |
| POST | `/api/auth/users` | Novi korisnik (Admin) |

---

## Rješavanje Problema

**Greška "ECONNREFUSED" na pokretanju:**
→ PostgreSQL nije pokrenut. Otvori Services.msc → pokreni "postgresql-x64-16"

**"relation does not exist":**
→ Nisi pokrenuo `npm run setup-db`. Pokreni ponovo.

**Cloudflare tunel ne radi:**
→ Provjeri da je server.js pokrenut na portu 3000 prije pokretanja tunela.

**Korisnik se ne može prijaviti:**
→ Provjeri da je `active = TRUE` u bazi. Admini mogu deaktivirati korisnike ali ne i sami sebe.

---

*TM Time Manager v1.0 · Studio Seven Malta*

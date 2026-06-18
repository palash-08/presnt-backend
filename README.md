# Presnt Backend

Self-hosted backend for the **Presnt** attendance tracking app. Replaces Firebase with Express + PostgreSQL + Socket.io.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT + bcrypt + Google OAuth
- **Real-time**: Socket.io
- **Push**: Expo Push Notifications
- **Email**: Nodemailer (Gmail SMTP)

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your values:
#   - DATABASE_URL: your PostgreSQL connection string
#   - JWT_SECRET: a random 64-char hex string
#   - SMTP_USER/SMTP_PASS: your Gmail + app password
```

### 3. Set up database
```bash
# Create tables
npx prisma migrate dev --name init

# Or push schema directly (dev only)
npx prisma db push
```

### 4. Run the server
```bash
# Development (hot-reload)
npm run dev

# Production
npm run build
npm start
```

Server runs on `http://localhost:3001` by default.

## DigitalOcean VPS Deployment

### 1. SSH into your VPS
```bash
ssh root@your-vps-ip
```

### 2. Install Node.js + PostgreSQL
```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib
```

### 3. Create database
```bash
sudo -u postgres psql
CREATE DATABASE presnt_db;
CREATE USER presnt_user WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE presnt_db TO presnt_user;
\q
```

### 4. Clone and setup
```bash
git clone https://github.com/palash-08/presnt-backend.git
cd presnt-backend
npm install
cp .env.example .env
nano .env  # fill in your values
npx prisma migrate deploy
npm run build
```

### 5. Run with PM2 (process manager)
```bash
npm install -g pm2
pm2 start dist/index.js --name presnt-backend
pm2 save
pm2 startup  # auto-start on reboot
```

### 6. Set up Nginx reverse proxy
```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 7. SSL with Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com
```

## API Endpoints (31 total)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ✗ | Register with email/password |
| POST | `/api/auth/login` | ✗ | Login with email/password |
| POST | `/api/auth/google` | ✗ | Google OAuth login |
| POST | `/api/auth/forgot-password` | ✗ | Password reset email |
| GET | `/api/auth/me` | ✓ | Get current user profile |
| PATCH | `/api/users/:id` | ✓ | Update profile |
| GET | `/api/users/:id/notifications` | ✓ | Get notifications |
| GET | `/api/groups` | ✓ | List user's groups |
| POST | `/api/groups` | ✓ | Create group |
| GET | `/api/groups/:id` | ✓ | Get group details |
| DELETE | `/api/groups/:id` | ✓ | Delete group |
| GET | `/api/groups/:id/members` | ✓ | Get member profiles |
| POST | `/api/groups/:id/join` | ✓ | Join group |
| POST | `/api/groups/:id/leave` | ✓ | Leave group |
| PATCH | `/api/groups/:id/roles` | ✓ | Change member role |
| GET | `/api/subjects` | ✓ | Get subjects |
| POST | `/api/subjects` | ✓ | Create subject |
| PATCH | `/api/subjects/:id` | ✓ | Update subject |
| DELETE | `/api/subjects/:id` | ✓ | Delete subject |
| GET | `/api/schedule` | ✓ | Get schedule |
| POST | `/api/schedule` | ✓ | Create schedule entry |
| DELETE | `/api/schedule/:id` | ✓ | Delete schedule entry |
| GET | `/api/attendance` | ✓ | Get attendance records |
| GET | `/api/attendance/students` | ✓ | Get students for marking |
| GET | `/api/attendance/:subjectId/history` | ✓ | Get attendance history |
| POST | `/api/attendance/mark` | ✓ | Admin: mark attendance |
| POST | `/api/attendance/self-mark` | ✓ | Student: self-mark |
| POST | `/api/attendance/reset` | ✓ | Reset attendance |
| GET | `/api/reports/attendance` | ✓ | Generate CSV report |
| POST | `/api/notifications/group/:id` | ✓ | Notify group |
| POST | `/api/notifications/user/:id` | ✓ | Notify user |

## Database Schema

View the full schema in [`prisma/schema.prisma`](prisma/schema.prisma).

8 tables: `User`, `Group`, `GroupMember`, `Subject`, `Schedule`, `AttendanceRecord`, `AttendanceHistory`, `Notification`

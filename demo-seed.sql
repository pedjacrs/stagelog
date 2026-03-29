```sql
-- ==========================================
-- DEMO TENANT SEED DATA
-- AV Productions Demo Company
-- ==========================================

BEGIN;

-- 1. KREIRANJE DEMO TENANT-a
INSERT INTO tenants (id, name, slug, active, expires_at, plan, max_users)
VALUES (2, 'AV Productions Ltd', 'av-demo', true, NOW() + INTERVAL '14 days', 'demo', NULL)
ON CONFLICT (id) DO UPDATE SET
name = EXCLUDED.name,
slug = EXCLUDED.slug,
active = EXCLUDED.active,
expires_at = EXCLUDED.expires_at;

-- 2. PROJECT TYPES
INSERT INTO project_types (name, color, tenant_id) VALUES
('Concert', '#E11D48', 2),
('Corporate Event', '#3B82F6', 2),
('Conference', '#0891B2', 2),
('Wedding', '#EC4899', 2),
('Festival', '#DC2626', 2),
('Broadcast', '#7C3AED', 2),
('Theatre Show', '#059669', 2)
ON CONFLICT DO NOTHING;

-- 3. AV ROLES
INSERT INTO av_roles (name, tenant_id) VALUES
('Project Manager', 2),
('Audio Engineer', 2),
('Video Operator', 2),
('Lighting Tech', 2),
('Stage Manager', 2),
('Camera Op', 2),
('Sound Tech', 2),
('Runner', 2),
('Production Assistant', 2),
('Rigger', 2)
ON CONFLICT DO NOTHING;

-- 4. EMPLOYEES (password za sve je "password123")
INSERT INTO employees (name, email, password, role, employment, daily_hours, active, tenant_id, badge_number, created_at) VALUES
('Sarah Mitchell', 'sarah@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'administrator', 'full_time', 8, true, 2, 'AV001', NOW() - INTERVAL '2 years'),
('James Rodriguez', 'james@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'project_manager', 'full_time', 8, true, 2, 'AV002', NOW() - INTERVAL '18 months'),
('Mike Thompson', 'mike@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'project_lead', 'full_time', 8, true, 2, 'AV003', NOW() - INTERVAL '1 year'),
('Emma Davies', 'emma@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'full_time', 8, true, 2, 'AV004', NOW() - INTERVAL '10 months'),
('Alex Chen', 'alex@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'full_time', 8, true, 2, 'AV005', NOW() - INTERVAL '8 months'),
('Sophie Williams', 'sophie@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'part_time', 6, true, 2, 'AV006', NOW() - INTERVAL '6 months'),
('Tom Baker', 'tom@freelance.com', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'freelance', 8, true, 2, 'FL001', NOW() - INTERVAL '4 months'),
('Lisa Park', 'lisa@techcrew.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'subcontractor', 8, true, 2, 'SC001', NOW() - INTERVAL '3 months'),
('David Johnson', 'david@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'viewer', 'full_time', 8, false, 2, 'AV007', NOW() - INTERVAL '1 year'),
('Rachel Green', 'rachel@avproductions.co.uk', '$2b$12$LQv3c1yqBwuvHwHAVKN.yur5QK9smUEqcZKJZZqP2u3zyLdqS5O3G', 'project_lead', 'full_time', 8, false, 2, 'AV008', NOW() - INTERVAL '15 months')
ON CONFLICT (email) DO NOTHING;

-- 5. VEHICLES
INSERT INTO vehicles (name, plate, active, tenant_id) VALUES
('Mercedes Sprinter Van', 'AV67 XYZ', true, 2),
('Ford Transit Equipment Van', 'AV23 ABC', true, 2),
('Iveco Daily Truck', 'AV89 DEF', true, 2),
('VW Crafter Mobile Unit', 'AV45 GHI', true, 2),
('Trailer - Generator', 'TR01 AVP', true, 2)
ON CONFLICT DO NOTHING;

-- 6. PROJECTS
INSERT INTO projects (
name, type_id, location, client_name, start_date, deadline,
description, status, default_start, default_end, tenant_id,
created_by, job_number, progress
) VALUES
('Royal Opera House Gala',
(SELECT id FROM project_types WHERE name = 'Concert' AND tenant_id = 2 LIMIT 1),
'Royal Opera House, Covent Garden', 'Royal Opera House',
CURRENT_DATE + INTERVAL '3 days', CURRENT_DATE + INTERVAL '3 days',
'Annual charity gala with full orchestra and 3 soloists. Premium audio setup and multi-camera recording.',
'confirmed', '14:00', '23:00', 2,
(SELECT id FROM employees WHERE email = 'sarah@avproductions.co.uk' AND tenant_id = 2 LIMIT 1),
'SL-2024-0001', 25),

('TechCorp Annual Conference',
(SELECT id FROM project_types WHERE name = 'Conference' AND tenant_id = 2 LIMIT 1),
'ExCeL London, Royal Victoria Dock', 'TechCorp International',
CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE + INTERVAL '9 days',
'3-day corporate conference with keynotes, breakouts and hybrid streaming. 500 attendees + online.',
'confirmed', '07:00', '19:00', 2,
(SELECT id FROM employees WHERE email = 'james@avproductions.co.uk' AND tenant_id = 2 LIMIT 1),
'SL-2024-0002', 60),

('Smith & Johnson Wedding',
(SELECT id FROM project_types WHERE name = 'Wedding' AND tenant_id = 2 LIMIT 1),
'The Savoy Hotel, London', 'Emma Smith & Michael Johnson',
CURRENT_DATE + INTERVAL '20 days', CURRENT_DATE + INTERVAL '20 days',
'Luxury wedding reception for 120 guests. Ceremony and reception AV, live band support.',
'confirmed', '10:00', '02:00', 2,
(SELECT id FROM employees WHERE email = 'mike@avproductions.co.uk' AND tenant_id = 2 LIMIT 1),
'SL-2024-0003', 10),

('Glastonbury Documentary',
(SELECT id FROM project_types WHERE name = 'Broadcast' AND tenant_id = 2 LIMIT 1),
'Worthy Farm, Somerset', 'BBC Documentary Unit',
CURRENT_DATE + INTERVAL '45 days', CURRENT_DATE + INTERVAL '50 days',
'Behind-the-scenes documentary filming during festival week. Multiple camera crews.',
'pending', '06:00', '24:00', 2,
(SELECT id FROM employees WHERE email = 'sarah@avproductions.co.uk' AND tenant_id = 2 LIMIT 1),
'SL-2024-0004', 0),

('NHS Awards Ceremony',
(SELECT id FROM project_types WHERE name = 'Corporate Event' AND tenant_id = 2 LIMIT 1),
'Guildhall, City of London', 'NHS Foundation Trust',
CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '10 days',
'Annual awards ceremony. Live stream to 10,000+ viewers nationwide.',
'completed', '17:00', '22:00', 2,
(SELECT id FROM employees WHERE email = 'james@avproductions.co.uk' AND tenant_id = 2 LIMIT 1),
'SL-2024-0005', 100)
ON CONFLICT DO NOTHING;

-- 7. PROJECT CREW
INSERT INTO project_crew (project_id, employee_id, av_role, start_time, end_time)
SELECT
p.id, e.id, crew.role, crew.start_time::time, crew.end_time::time
FROM projects p
CROSS JOIN (
VALUES
('sarah@avproductions.co.uk', 'Project Manager', '12:00', '23:59'),
('mike@avproductions.co.uk', 'Audio Engineer', '13:00', '23:59'),
('emma@avproductions.co.uk', 'Lighting Tech', '14:00', '23:30'),
('alex@avproductions.co.uk', 'Camera Op', '15:00', '23:30'),
('tom@freelance.com', 'Sound Tech', '14:00', '23:59')
) crew(email, role, start_time, end_time)
JOIN employees e ON e.email = crew.email AND e.tenant_id = 2
WHERE p.name = 'Royal Opera House Gala' AND p.tenant_id = 2
ON CONFLICT DO NOTHING;

INSERT INTO project_crew (project_id, employee_id, av_role, start_time, end_time)
SELECT
p.id, e.id, crew.role, crew.start_time::time, crew.end_time::time
FROM projects p
CROSS JOIN (
VALUES
('james@avproductions.co.uk', 'Project Manager', '06:00', '20:00'),
('mike@avproductions.co.uk', 'Audio Engineer', '07:00', '19:00'),
('sophie@avproductions.co.uk', 'Video Operator', '07:30', '19:00'),
('alex@avproductions.co.uk', 'Camera Op', '08:00', '18:00'),
('lisa@techcrew.co.uk', 'Stage Manager', '06:30', '19:30'),
('tom@freelance.com', 'Runner', '07:00', '19:00')
) crew(email, role, start_time, end_time)
JOIN employees e ON e.email = crew.email AND e.tenant_id = 2
WHERE p.name = 'TechCorp Annual Conference' AND p.tenant_id = 2
ON CONFLICT DO NOTHING;

-- 8. VEHICLES PER PROJECT
INSERT INTO project_vehicles (project_id, vehicle_id)
SELECT p.id, v.id
FROM projects p
JOIN vehicles v ON v.tenant_id = 2
WHERE p.name = 'Royal Opera House Gala' AND p.tenant_id = 2
AND v.name IN ('Mercedes Sprinter Van', 'Ford Transit Equipment Van')
ON CONFLICT DO NOTHING;

INSERT INTO project_vehicles (project_id, vehicle_id)
SELECT p.id, v.id
FROM projects p
JOIN vehicles v ON v.tenant_id = 2
WHERE p.name = 'TechCorp Annual Conference' AND p.tenant_id = 2
AND v.name IN ('Iveco Daily Truck', 'VW Crafter Mobile Unit')
ON CONFLICT DO NOTHING;

-- 9. TIME ENTRIES (završen projekat)
INSERT INTO time_entries (
employee_id, project_id, entry_date, task, start_time, end_time,
duration_min, notes, status, tenant_id, created_by
)
SELECT
e.id, p.id,
CURRENT_DATE - INTERVAL '10 days',
entries.task, entries.start_time::time, entries.end_time::time,
EXTRACT(EPOCH FROM (entries.end_time::time - entries.start_time::time))/60,
entries.notes, 'approved', 2,
(SELECT id FROM employees WHERE email = 'james@avproductions.co.uk' AND tenant_id = 2 LIMIT 1)
FROM projects p
CROSS JOIN (
VALUES
('james@avproductions.co.uk', 'Project management', '15:00', '22:30', 'Managed full event setup and client liaison'),
('mike@avproductions.co.uk', 'Audio engineering', '16:00', '22:30', 'Mixed live ceremony and broadcast feed'),
('emma@avproductions.co.uk', 'Lighting operation', '16:30', '22:00', 'Stage lighting and follow spots for awards'),
('alex@avproductions.co.uk', 'Camera operation', '17:00', '22:00', 'Camera 2 - audience and reactions'),
('sophie@avproductions.co.uk', 'Video switching', '17:30', '22:00', 'Live switching and broadcast direction'),
('tom@freelance.com', 'Audio support', '17:00', '22:00', 'Monitor mixing and backup systems')
) entries(email, task, start_time, end_time, notes)
JOIN employees e ON e.email = entries.email AND e.tenant_id = 2
WHERE p.name = 'NHS Awards Ceremony' AND p.tenant_id = 2
ON CONFLICT DO NOTHING;

-- 10. PULL SHEET ENTRIES (sample)
INSERT INTO pull_sheet_entries (
project_id, entry_date, employee_id, employee_name, av_role,
hours_worked, overtime, notes, tenant_id, created_by
)
SELECT
p.id,
CURRENT_DATE - INTERVAL '10 days',
e.id, e.name, ps.av_role,
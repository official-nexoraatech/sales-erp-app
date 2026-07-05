INSERT INTO countries (name, iso_code, currency_code, status, created_by, created_at, is_deleted)
SELECT 'India', 'IN', 'INR', 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP, FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM countries
    WHERE LOWER(name) = LOWER('India')
);

WITH india AS (
    SELECT id
    FROM countries
    WHERE LOWER(name) = LOWER('India')
    ORDER BY id
    LIMIT 1
)
INSERT INTO states (country_id, state_name, state_code, gst_code, status, created_by, created_at, is_deleted)
SELECT india.id, seed.state_name, seed.state_code, seed.gst_code, 'ACTIVE', 'SYSTEM', CURRENT_TIMESTAMP, FALSE
FROM india
CROSS JOIN (
    VALUES
        ('Andaman and Nicobar Islands', 'IN-AN', '35'),
        ('Andhra Pradesh', 'IN-AP', '37'),
        ('Arunachal Pradesh', 'IN-AR', '12'),
        ('Assam', 'IN-AS', '18'),
        ('Bihar', 'IN-BR', '10'),
        ('Chandigarh', 'IN-CH', '04'),
        ('Chhattisgarh', 'IN-CT', '22'),
        ('Dadra and Nagar Haveli and Daman and Diu', 'IN-DH', '26'),
        ('Delhi', 'IN-DL', '07'),
        ('Goa', 'IN-GA', '30'),
        ('Gujarat', 'IN-GJ', '24'),
        ('Haryana', 'IN-HR', '06'),
        ('Himachal Pradesh', 'IN-HP', '02'),
        ('Jammu and Kashmir', 'IN-JK', '01'),
        ('Jharkhand', 'IN-JH', '20'),
        ('Karnataka', 'IN-KA', '29'),
        ('Kerala', 'IN-KL', '32'),
        ('Ladakh', 'IN-LA', '38'),
        ('Lakshadweep', 'IN-LD', '31'),
        ('Madhya Pradesh', 'IN-MP', '23'),
        ('Maharashtra', 'IN-MH', '27'),
        ('Manipur', 'IN-MN', '14'),
        ('Meghalaya', 'IN-ML', '17'),
        ('Mizoram', 'IN-MZ', '15'),
        ('Nagaland', 'IN-NL', '13'),
        ('Odisha', 'IN-OD', '21'),
        ('Puducherry', 'IN-PY', '34'),
        ('Punjab', 'IN-PB', '03'),
        ('Rajasthan', 'IN-RJ', '08'),
        ('Sikkim', 'IN-SK', '11'),
        ('Tamil Nadu', 'IN-TN', '33'),
        ('Telangana', 'IN-TG', '36'),
        ('Tripura', 'IN-TR', '16'),
        ('Uttar Pradesh', 'IN-UP', '09'),
        ('Uttarakhand', 'IN-UT', '05'),
        ('West Bengal', 'IN-WB', '19')
) AS seed(state_name, state_code, gst_code)
WHERE NOT EXISTS (
    SELECT 1
    FROM states existing
    WHERE existing.country_id = india.id
      AND LOWER(existing.state_name) = LOWER(seed.state_name)
);

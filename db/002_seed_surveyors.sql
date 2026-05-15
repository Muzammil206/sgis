-- =============================================================================
-- SGIS — 002_seed_surveyors.sql
-- 56 licensed surveyors · Kwara State KWGIS
-- Extracted from SGIS_v3.html prototype · Naviss Technologies
-- Run AFTER 001_schema.sql, BEFORE any application data is entered.
-- =============================================================================

TRUNCATE TABLE surveyors RESTART IDENTITY CASCADE;

INSERT INTO surveyors (user_id, name, surveyor_reg, phone, email, status) VALUES
  ('H1198', 'SURV. VINCENT OLAITAN OLUSHOLA', '1198', '8035616683', 'survolushola@gmail.com', 'active'),
  ('AT4629', 'SURV. KEHINDE TIJANI', '4629', '7068445447', 'teejaylandgeospatial@gmail.com', 'active'),
  ('C1702', 'SURV. CHUKWUDINMA JOHN ONUAGWA', '1702', '8035814749', 'cjonuagwa@gmail.com', 'active'),
  ('N1208', 'SURV. TAFA BABATUNDE ATIKU', '1208', '8033861238', 'ajobibabs@gmail.com', 'active'),
  ('AR524', 'SURV. RASAK ADEMOLA SALAWU', '524', '8033701940', 'stabudsurveysnigeria@gmail.com', 'active'),
  ('BT5136', 'SURV. OLUWATOMI DAVID DADA', '5136', '8107333000', 'dadaoluwatomi@gmail.com', 'active'),
  ('AD3465', 'SURV. SAMUEL OLUWAFEMI MUYIWA', '3465', '8066052578', 'samuelomuyiwa@gmail.com', 'active'),
  ('BH4698', 'SURV. SOLOMON BOLUWATIFE BUKOYE', '4698', '8163168514', 'solomonbukoye@gmail.com', 'active'),
  ('Y343', 'SURV. BOBADOYE LUKE ABAYOMI', '343', '8037408134', 'abayomibobadoye@gmail.com', 'active'),
  ('AZ4410', 'SURV. AMUDA OLUGBENGA WASIU', '4410', '8033545325', 'wasiu.amuda@yahoo.com', 'active'),
  ('BY5263', 'SURV. OGUNTAYO BERNARD YINKA', '5263', '7032406837', 'bernarddare302@gmail.com', 'active'),
  ('BK4818', 'SURV. BABATUNDE KABIR', '4818', '8067599742', 'gabgeomaticandconsultltd@gmail.com', 'active'),
  ('AQ3629', 'SURV. ABDULBAQY MARIAM GOBIR', '3629', '8038465428', 'imamrahmah9@gmail.com', 'active'),
  ('I1289', 'SURV. ABDULWAHAB OLATUNJI OYETOKE', '1289', '8022556977', 'tunjitoke01@gmail.com', 'active'),
  ('BZ5929', 'SURV. ABDULRASAQ MUMEEN ADEBAYO', '5929', '8131973384', 'Mumeenadebayo1@gmail.com', 'active'),
  ('BW5927', 'SURV. WILLIAMS KAZEEM ABIODUN', '5927', '7069191042', 'jabaruti8@gmail.com', 'active'),
  ('AX4208', 'SURV. BELLO FELIX DIRAN', '4208', '8068038663', 'bellofelixdiran1905@gmail.com', 'active'),
  ('E1952', 'SURV. IBRAHIM ALHAJI MOHAMMED', '1952', '8035755399', 'ibro6467@gmail.com', 'active'),
  ('R0999', 'SURV. LERE OLUSEGUN ADEWALE', '999', '8033961373', 'lereadewale@gmail.com', 'active'),
  ('AN3846', 'SURV. SURAJUDEEN OWOLABI JIMOH', '3846', '8062687720', 'mentormoment77@gmail.com', 'active'),
  ('P779', 'SURV. POPOOLA TIMOTHY ADEKUNLE', '779', '8104746972', 'adekunletimothy994@gmail.com', 'active'),
  ('AL1396', 'SURV. ADEBAYO SULEMON KUNLE', '1396', '8033785626', 'adebayosulemon@gmail.com', 'active'),
  ('AU5208', 'SURV. KEHINDE OLADAPO', '5208', '7031191132', 'oladapokehinde@gmail.com', 'active'),
  ('BR5183', 'SURV. RASHIDAT AHUOIZA IGANYI', '5183', '8138552473', 'iganyirashidat@gmail.com', 'active'),
  ('KP1318', 'SURV. ABUBAKARGARBA AREMU', '1318', '8038100059', 'abubakargarba63@gmail.com', 'active'),
  ('AY3054', 'SURV. BAMIDELE ESTHER AYOOLA', '3054', '8053533889', 'ayoolabamidele95@gmail.com', 'active'),
  ('K1888', 'SURV. MAROUF ADEKUNLE AJEIGBE', '1888', '8062642201', 'ajmasurveys24@gmail.com', 'active'),
  ('BX5578', 'SURV. ADEWUMI MORAYO ABIODUN', '5578', '8036348192', 'abiodunadewumi1@gmail.com', 'active'),
  ('S316', 'SURV. SALAUDEEN OZIGI SANNI', '316', '9070300099', 'ssalaudeen033@gmail.com', 'active'),
  ('BP5459', 'SURV. ADEYEMO NURUDEEN', '5459', '7038183973', 'ibnshuahib.ade@gmail.com', 'active'),
  ('BU6177', 'SURV. MOHAMMED MODINAT OMOBUKOLA', '6177', '8154415218', 'modinat315@gmail.com', 'active'),
  ('X616', 'SURV. EZEKIEL OLUWASANJO AJIBOYE', '616', '8035616686', 'sanjoajiboye@yahoo.com', 'active'),
  ('BI5314', 'SURV. ABDULMAJEED BAMAIYI ORIRE', '5314', '8039324137', 'almuradgeoinformatics@gmail.com', 'active'),
  ('UILENL-1128', 'UNILORIN CONSULTANCY SERVICES LIMITED', 'ENL-1128', '7063404832', 'surveygeo300@unilorin.edu.ng', 'active'),
  ('BE4560', 'SURV. MICHAEL OLURANTI OGUNNIYI', '4560', '8065735063', 'survmyk@gmail.com', 'active'),
  ('AC3246', 'SURV. AYODEJI OLUWAMUYIWA FUNSHO-SALAWU', '3246', '8035025960', 'jcayomideji@gmail.com', 'active'),
  ('W1512', 'SURV. BASIRU AYOADE AKINADE', '1512', '8035812690', 'survakinade@gmail.com', 'active'),
  ('BC6152', 'SURV. IREWOLE MATHEW TOBI', '6152', '7035669251', 'irewolemathewtobi@gmail.com', 'active'),
  ('BL5829', 'SURV. HAUWAU LARE SHAABA', '5829', '7068881244', 'hauwaulare@gmail.com', 'active'),
  ('BF4830', 'SURV. BODUNDE FRANCIS ABIODUN', '4830', '8034299370', 'francisabiodun10@gmail.com', 'active'),
  ('Z1171', 'SURV. ANISHE JAMES BABATUNSIN', '1171', '8034925104', 'jbanishesc@gmail.com', 'active'),
  ('T595', 'SURV. FESTUS OLUSEGUN ADETIFA', '595', '8068739937', 'foluadetifa@gmail.com', 'active'),
  ('AI4355', 'SURV. ADEJIMOLA OLAYEMI USMAN', '4355', '7034226962', 'adejimolaou2007@gmail.com', 'active'),
  ('Q1980', 'SURV. OPALEYE OLUWAFEMI JAMES', '1980', '8036753181', 'jolmarkscompany@gmail.com', 'active'),
  ('AK2177', 'SURV. TAJUDEEN ADISA KADIRI', '2177', '7037066191', 'kadiritajudeen5@gmail.com', 'active'),
  ('BM4764', 'SURV. MUDATHIR ADEKUNLE ADEDEJI', '4764', '8083808806', 'mudadedeji@gmail.com', 'active'),
  ('A834', 'SURV. TIMOTHY OLANIYI ADEKEYE', '834', '8035899106', 'timotekint@yahoo.com', 'active'),
  ('BA1373', 'SURV. OLOWONIREJUARO WONUOLA ROTIMI', '1373', '8060110961', 'olowonirejuarorotimi@gmail.com', 'active'),
  ('AS1316', 'SURV. IBRAHIM SALIMAN USMAN', '1316', '7036905337', 'ibrahim.attah1959@gmail.com', 'active'),
  ('AV4344', 'SURV. FATAI GANIYU ABDULRAHEEM', '4344', '7032060681', 'fataiabdulraheemg@gmail.com', 'active'),
  ('BV6051', 'SURV. KAOTHAR OMOLARA AHMED', '6051', '7039119008', 'laraex4nig@gmail.com', 'active'),
  ('AH2257', 'SURV. ISSA MOBOLAJI ISHOLA', '2257', '8055911048', 'mapview77@gmail.com', 'active'),
  ('AG1278', 'SURV. JIMOH FOLORUNSO YUSUF', '1278', '8066980443', 'yusufjimoh459@gmail.com', 'active'),
  ('BN4972', 'SURV. NIMAT OLAJUMOKE OYEBODE', '4972', '8088174159', 'nihamsurveys@gmail.com', 'active'),
  ('AA2080', 'SURV. MICHEAL ADEMOLA OGUNDIMINI', '2080', '8032288984', 'michogad2@gmail.com', 'active'),
  ('BQ5496', 'SURV. JOLAYEMI STEPHEN AKINYEMI', '5496', '7030189780', 'arkjollyment@gmail.com', 'active');

-- 56 surveyors seeded.
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active FROM surveyors;
const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(cors());

// Konfigurasi Koneksi Microsoft SQL Server (MSSQL)
const dbConfig = {
    server: 'localhost',          
    database: 'MicroSehat',
    user: 'sa',
    password: 'Password123',       
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    connectionTimeout: 60000,
    requestTimeout: 60000
};

// Global Connection Pool
const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ Terhubung Ke SQL Server Database: MicroSehat');
        return pool;
    })
    .catch(err => {
        console.error('❌ Gagal Koneksi MSSQL:', err.message);
    });

function parseDecimal(val) {
    if (val === undefined || val === null || val === '') return 0;
    let clean = String(val).replace(/['',]/g, '').trim();
    let num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

function parseCleanString(val, defaultVal = '') {
    if (!val) return defaultVal;
    return String(val).replace(/^'/, '').trim();
}

function parseKtp(val) {
    if (!val) return '3271000000000000';
    let clean = String(val).replace(/[^0-9]/g, '');
    return clean.length > 0 ? clean : '3271000000000000';
}

function parseDateSQL(dateStr) {
    if (!dateStr || dateStr === '-' || dateStr === 'undefined' || dateStr === 'null') return null;
    let str = String(dateStr).replace(/^'/, '').trim();
    let num = Number(str);
    if (!isNaN(num) && num > 30000 && num < 60000) {
        let utc_days = Math.floor(num - 25569);
        let utc_value = utc_days * 86400;
        let date_info = new Date(utc_value * 1000);
        let yr = date_info.getUTCFullYear();
        let mo = String(date_info.getUTCMonth() + 1).padStart(2, '0');
        let da = String(date_info.getUTCDate()).padStart(2, '0');
        return `${yr}-${mo}-${da}`;
    }

    let parts = str.split('-');
    if (parts.length === 3 && isNaN(parts[1])) {
        let months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        let day = parseInt(parts[0], 10);
        let month = months[parts[1].toLowerCase()];
        let year = parseInt(parts[2], 10);
        year = year < 100 ? 2000 + year : year;
        if (!isNaN(day) && month !== undefined && !isNaN(year)) {
            let yr = year;
            let mo = String(month + 1).padStart(2, '0');
            let da = String(day).padStart(2, '0');
            return `${yr}-${mo}-${da}`;
        }
    }

    let d = new Date(str);
    if (isNaN(d.getTime())) return null;
    let yr = d.getFullYear();
    let mo = String(d.getMonth() + 1).padStart(2, '0');
    let da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
}

// ==========================================
// 0. ENDPOINT: LOGIN AUTENTIKASI USER (MSSQL)
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let pool = await poolPromise;
        let result = await pool.request()
            .input('username', sql.VarChar, username)
            .input('password', sql.VarChar, password)
            .query('SELECT user_id, username, full_name, role FROM dbo.m_users WHERE username = @username AND password_hash = @password');

        if (result.recordset.length > 0) {
            res.json({ success: true, user: result.recordset[0] });
        } else {
            res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 1. ENDPOINT: AMBIL DATA INFORCE (GET)
// ==========================================
app.get('/api/inforce', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query('SELECT * FROM dbo.Peserta_Inforce');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil data inforce: ' + err.message });
    }
});

// ==========================================
// 2. ENDPOINT: UPLOAD DATA INFORCE PESERTA
// ==========================================
app.post('/api/upload-inforce', async (req, res) => {
    const listData = req.body; 
    if (!listData || listData.length === 0) {
        return res.status(400).json({ error: 'Tidak ada data inforce yang dikirim.' });
    }

    try {
        let pool = await poolPromise;
        if (!pool) throw new Error("Database connection pool belum siap.");

        let successCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;

        for (let item of listData) {
            try {
                let idPeserta = parseCleanString(item.idPeserta);
                if (!idPeserta) continue;

                let reqSql = pool.request();
                reqSql.input('id_peserta', sql.VarChar(50), idPeserta);
                reqSql.input('no_resi', sql.VarChar(50), parseCleanString(item.noResi, '-'));
                reqSql.input('no_ktp', sql.VarChar(20), parseKtp(item.noKtp));
                reqSql.input('nama_tertanggung', sql.NVarChar(255), parseCleanString(item.namaTtg, 'Peserta'));
                reqSql.input('usia', sql.Int, parseInt(item.umur) || 35);
                reqSql.input('uang_pertanggungan', sql.Decimal(18,2), parseDecimal(item.up));
                reqSql.input('premi', sql.Decimal(18,2), parseDecimal(item.premi));
                reqSql.input('masa_asuransi', sql.VarChar(50), parseCleanString(item.masaAs, '1 Bulan'));
                reqSql.input('tanggal_mulai', sql.Date, parseDateSQL(item.mulai));
                reqSql.input('tanggal_akhir', sql.Date, parseDateSQL(item.akhir));
                reqSql.input('nama_penerima_manfaat', sql.NVarChar(255), parseCleanString(item.pmNama, 'Ahli Waris'));
                reqSql.input('kode_produk', sql.VarChar(50), parseCleanString(item.kodeProduk, 'HI-X17'));
                reqSql.input('Nama_Produk', sql.NVarChar(100), parseCleanString(item.namaProduk, 'Micro Sehat'));
                reqSql.input('desc_uker', sql.NVarChar(255), parseCleanString(item.descUker, ''));
                reqSql.input('nik_pegawai', sql.VarChar(50), parseCleanString(item.nikPegawai, ''));
                reqSql.input('nama_pegawai', sql.NVarChar(255), parseCleanString(item.namaPegawai, ''));
                reqSql.input('email', sql.VarChar(255), parseCleanString(item.email, ''));
                reqSql.input('no_polis', sql.VarChar(100), parseCleanString(item.noPolis || item.noResi, '-'));
                reqSql.input('id_upload', sql.VarChar(100), parseCleanString(item.idUpload, ''));
                reqSql.input('hubungan_tertanggung', sql.VarChar(100), parseCleanString(item.hubunganTtg, 'Diri Sendiri'));

                await reqSql.query(`
                    IF NOT EXISTS (SELECT 1 FROM dbo.Peserta_Inforce WHERE id_peserta = @id_peserta)
                    BEGIN
                        INSERT INTO dbo.Peserta_Inforce 
                        (id_peserta, no_resi, no_ktp, nama_tertanggung, usia, uang_pertanggungan, premi, masa_asuransi, tanggal_mulai, tanggal_akhir, nama_penerima_manfaat, kode_produk, Nama_Produk, desc_uker, nik_pegawai, nama_pegawai, email, no_polis, id_upload, hubungan_tertanggung)
                        VALUES 
                        (@id_peserta, @no_resi, @no_ktp, @nama_tertanggung, @usia, @uang_pertanggungan, @premi, @masa_asuransi, @tanggal_mulai, @tanggal_akhir, @nama_penerima_manfaat, @kode_produk, @Nama_Produk, @desc_uker, @nik_pegawai, @nama_pegawai, @email, @no_polis, @id_upload, @hubungan_tertanggung)
                    END
                `);
                successCount++;
            } catch (err) {
                if (err.number === 2627 || err.number === 2601) {
                    duplicateCount++;
                } else {
                    errorCount++;
                    console.error(`❌ Gagal Insert ID [${item.idPeserta}]:`, err.message);
                }
            }
        }

        res.json({ message: 'Upload inforce selesai', inserted: successCount, duplicates: duplicateCount, errors: errorCount });

    } catch (err) {
        console.error('Koneksi Database Gagal:', err.message);
        res.status(500).json({ error: 'Gagal terhubung ke database: ' + err.message });
    }
});

// ==========================================
// 3. ENDPOINT: SIMPAN RIWAYAT KLAIM
// ==========================================
app.post('/api/upload-klaim', async (req, res) => {
    const listKlaim = req.body; 
    if (!listKlaim || listKlaim.length === 0) {
        return res.status(400).json({ error: 'Tidak ada data klaim yang dikirim.' });
    }

    try {
        let pool = await poolPromise;
        let successCount = 0;
        let errorCount = 0;

        for (let item of listKlaim) {
            try {
                let reqSql = pool.request();
                reqSql.input('id_peserta', sql.VarChar(50), parseCleanString(item.idPeserta));
                reqSql.input('jenis_klaim', sql.VarChar(100), parseCleanString(item.jenis));
                reqSql.input('tanggal_kejadian', sql.Date, parseDateSQL(item.tanggalKejadian) || new Date());
                reqSql.input('nilai_klaim_disetujui', sql.Decimal(18,2), parseDecimal(item.jumlah));
                reqSql.input('status_klaim', sql.VarChar(50), parseCleanString(item.status, 'Disetujui'));

                await reqSql.query(`
                    INSERT INTO dbo.riwayat_klaim 
                    (id_peserta, jenis_klaim, tanggal_kejadian, nilai_klaim_disetujui, status_klaim)
                    VALUES (@id_peserta, @jenis_klaim, @tanggal_kejadian, @nilai_klaim_disetujui, @status_klaim)
                `);
                successCount++;
            } catch (err) {
                errorCount++;
                console.error('Error Klaim:', err.message);
            }
        }

        res.json({ message: 'Simpan riwayat klaim selesai', inserted: successCount, errors: errorCount });

    } catch (err) {
        console.error('Database connection error:', err.message);
        res.status(500).json({ error: 'Gagal terhubung ke database SQL Server.' });
    }
});

app.get('/api/klaim/:idPeserta', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request()
            .input('id_peserta', sql.VarChar(50), req.params.idPeserta)
            .query('SELECT * FROM dbo.riwayat_klaim WHERE id_peserta = @id_peserta');
        
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil data klaim.' });
    }
});

app.listen(3000, () => {
    console.log('🚀 Server Backend MSSQL Berjalan di http://localhost:3000');
});
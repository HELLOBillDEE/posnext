// Thai Kedmanee keyboard → ASCII (แปลงบาร์โค้ดที่ยิงขณะอยู่โหมดภาษาไทย)
const TH2EN = {
  // Number row — Thai numerals ๑-๙,๐ + Thai chars at - =
  'ๅ':'`',
  '๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9','๐':'0',
  'ข':'-','ช':'=',
  // QWERTY row
  'ๆ':'q','ไ':'w','ำ':'e','พ':'r','ะ':'t','ั':'y','ี':'u','ร':'i','น':'o','ย':'p','บ':'[','ล':']','ฃ':'\\',
  // ASDF row
  'ฟ':'a','ห':'s','ก':'d','ด':'f','เ':'g','้':'h','่':'j','า':'k','ส':'l','ว':';','ง':"'",
  // ZXCV row
  'ผ':'z','ป':'x','แ':'c','อ':'v','ิ':'b','ื':'n','ท':'m','ใ':',','ฌ':'.','ซ':'/',
}

export function convertThaiBarcode(str) {
  return str.split('').map(c => TH2EN[c] ?? c).join('')
}

export function isThaiInput(str) {
  return /[฀-๿]/.test(str)
}

export function fmt(n, dec = 2) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

export function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDT(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function genReceiptNo() {
  const d = new Date()
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `R${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function genPONo() {
  const d = new Date()
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `PO${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${String(Date.now()).slice(-4)}`
}

export const MONTHS_TH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

export const PAY_LABEL = { cash:'เงินสด', transfer:'โอน', qr:'QR', credit:'เชื่อ', card:'บัตร' }

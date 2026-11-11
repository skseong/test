import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
NODE_CHECK = r'''
const History = require('./web/history.js');
const XLSX = require('./web/lib/xlsx.full.min.js');
const cases = [
  { caseId: 'C-0001', status: '배분확정', question: { text: '산업정책 예산 집행 현황' }, events: [
    { at: '2026-11-11T00:00:00Z', type: '배분확정', by: '국회 총괄 담당', after: { lead: '산업정책과' } },
    { at: '2026-11-11T01:00:00Z', type: '회신', by: '산업정책과' }
  ] },
  { caseId: 'C-0002', status: '회신완료', question: { text: '산업정책 추진 현황' }, events: [
    { at: '2026-11-10T23:00:00Z', type: '회신', by: '산업정책과' }
  ] },
  { caseId: 'C-0003', status: '접수', question: { text: '예산 산업정책 현황' }, events: [
    { at: '2026-11-10T20:00:00Z', type: '접수', by: '국회 총괄 담당' }
  ] }
];
const records = History.recordsFromCases(cases, ['산업정책과']);
const byDepartment = History.filterRecords(records, { department: '산업정책과' });
const byPrefix = History.filterRecords(records, { questionPrefix: '산업정책 예산' });
const rows = History.exportRows(byDepartment);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '처리 기록');
const binary = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
const reopened = XLSX.read(binary, { type: 'buffer' });
const excelRows = XLSX.utils.sheet_to_json(reopened.Sheets['처리 기록'], { header: 1 }).length - 1;
console.log(JSON.stringify({ departmentCount: byDepartment.length, excelRows,
  prefixCaseIds: [...new Set(byPrefix.map(record => record.caseId))].sort() }));
'''


class TreatmentHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            ["node", "-e", NODE_CHECK], cwd=ROOT, text=True,
            capture_output=True, check=True
        )
        cls.result = json.loads(result.stdout.strip().splitlines()[-1])

    def test_department_filter_count_matches_excel_rows(self):
        self.assertEqual(self.result["departmentCount"], self.result["excelRows"])

    def test_question_filter_uses_prefix(self):
        self.assertEqual(self.result["prefixCaseIds"], ["C-0001"])


if __name__ == "__main__":
    unittest.main()

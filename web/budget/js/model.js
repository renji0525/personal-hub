// 家計簿の入力検証・編集・集計をブラウザとGASで共有する
var BudgetModel = (() => {
    const defaults = [
        ['cat_food', '食費', '#f5b86b'], ['cat_daily', '日用品', '#83cdbb'],
        ['cat_home', '住まい', '#94b9f4'], ['cat_travel', '交通費', '#b6a3ec'],
        ['cat_hobby', '趣味', '#ed9bac'], ['cat_salary', '給与', '#77cf98']
    ].map(([id, name, color]) => ({ id, name, color }));
    function id(value) {
        if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(value)) throw new Error('識別情報が正しくありません。');
        return value;
    }
    function category(value) {
        if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 40 ||
            typeof value.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value.color)) throw new Error('カテゴリ名と色を確認してください。');
        return { id: id(value.id), name: value.name.trim(), color: value.color.toLowerCase() };
    }
    function entry(value, categories) {
        if (!value || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
            !Number.isFinite(Date.parse(value.date + 'T00:00:00Z')) || new Date(value.date + 'T00:00:00Z').toISOString().slice(0, 10) !== value.date)
            throw new Error('日付を確認してください。');
        if (!['income', 'expense'].includes(value.type) || !Number.isSafeInteger(value.amount) || value.amount < 1 || value.amount > 999999999999)
            throw new Error('金額は1〜999,999,999,999円の整数で入力してください。');
        if (value.categoryId !== '' && !categories.some(c => c.id === value.categoryId)) throw new Error('カテゴリを選び直してください。');
        if (typeof value.memo !== 'string' || value.memo.length > 200) throw new Error('メモは200文字以内で入力してください。');
        return { id: id(value.id), date: value.date, type: value.type, categoryId: value.categoryId, amount: value.amount, memo: value.memo.trim() };
    }
    function apply(state, operation) {
        const next = { categories: state.categories.map(c => ({ ...c })), entries: state.entries.map(e => ({ ...e })) };
        if (!operation || typeof operation !== 'object') throw new Error('操作が正しくありません。');
        if (operation.type === 'categorySave') {
            const value = category(operation.value);
            if (next.categories.some(c => c.id !== value.id && c.name === value.name)) throw new Error('同じ名前のカテゴリがあります。');
            const index = next.categories.findIndex(c => c.id === value.id);
            if (index < 0) next.categories.push(value); else next.categories[index] = value;
        } else if (operation.type === 'categoryDelete') {
            const key = id(operation.id);
            if (next.entries.some(e => e.categoryId === key)) throw new Error('使用中のカテゴリです。記録のカテゴリを変更してから削除してください。');
            next.categories = next.categories.filter(c => c.id !== key);
        } else if (operation.type === 'entrySave') {
            const value = entry(operation.value, next.categories);
            const index = next.entries.findIndex(e => e.id === value.id);
            if (index < 0) next.entries.push(value); else next.entries[index] = value;
        } else if (operation.type === 'entryDelete') {
            const key = id(operation.id);
            next.entries = next.entries.filter(e => e.id !== key);
        } else throw new Error('未対応の操作です。');
        return next;
    }
    function summarize(entries) {
        let income = 0, expense = 0;
        const categories = new Map();
        entries.forEach(e => {
            if (e.type === 'income') income += e.amount;
            else { expense += e.amount; categories.set(e.categoryId, (categories.get(e.categoryId) || 0) + e.amount); }
        });
        if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) throw new Error('集計金額が上限を超えています。');
        return { income, expense, balance: income - expense, categories };
    }
    return { defaults, category, entry, apply, summarize };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BudgetModel;

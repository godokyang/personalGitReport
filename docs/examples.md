# Personal Git Report 使用示例

## 基础使用

### 1. 快速生成报告
```bash
# 分析当前目录
git-report

# 指定年份
git-report --year 2023

# 指定主题
git-report --theme light
git-report --theme dark
git-report --theme colorful
```

### 2. 指定作者和输出
```bash
# 分析特定作者
git-report --author "your-email@example.com"

# 自定义输出目录
git-report --output ./my-reports

# 生成多种格式
git-report --format html,json,pdf
```

### 3. 非交互模式
```bash
# 跳过交互式配置
git-report --no-interactive --year 2023 --theme dark
```

## 配置文件使用

### 创建配置文件
```bash
git-report init
```

### 修改配置文件 `git-report.config.js`
```javascript
module.exports = {
  author: "张三",
  email: "zhangsan@example.com",
  theme: "dark",
  showPrivateRepos: false,
  excludeWeekends: true,
  output: "./reports",
  format: ["html", "json"],
  includeMerges: false,
  excludePaths: ["node_modules", "*.min.js"],
  customStats: {
    countLines: true,
    analyzeComplexity: false,
    trackLearning: true
  }
};
```

## 多项目分析

### 分析多个项目
```bash
git-report multi --projects "/path/to/project1,/path/to/project2"
```

### 批量分析
```bash
# 分析当前目录下的所有Git仓库
for dir in */; do
  if [ -d "$dir/.git" ]; then
    git-report "$dir" --output "./reports/$(basename $dir)" --no-interactive
  fi
done
```

## 实际使用场景

### 场景1：个人年度总结
```bash
# 生成2023年个人年度报告
git-report --year 2023 --theme colorful --format html,pdf

# 查看详细统计
git-report --year 2023 --format json > report-data.json
```

### 场景2：团队贡献统计
```bash
# 分析团队成员贡献
git-report --author "teammate@company.com" --year 2023

# 导出数据用于团队汇报
git-report multi --projects "/proj1,/proj2,/proj3" --format json
```

### 场景3：技术栈分析
```bash
# 生成技术栈报告
git-report --year 2023 --output ./tech-analysis

# 结合配置文件自定义分析
# 创建 git-report.config.js
module.exports = {
  customStats: {
    countLines: true,
    analyzeComplexity: true,
    trackLearning: true
  }
};
git-report --config ./git-report.config.js
```

## 报告解读

### 基础统计指标
- **总提交数**: 一年中的代码提交次数
- **代码行数**: 新增和删除的代码行数
- **净增长**: 新增代码减去删除代码
- **连续天数**: 最长的连续提交天数

### 技术栈分析
- **语言分布**: 各种编程语言的使用比例
- **项目类型**: 前端、后端、全栈项目分布
- **技术趋势**: 技术栈的演进趋势

### 时间模式
- **活跃时段**: 24小时内的提交分布
- **工作习惯**: 工作日vs周末的活动对比
- **季节性**: 月度提交量的变化

## 常见问题

### Q1: 如何分析私有仓库？
A: 确保你有访问权限，使用本地路径即可：
```bash
git-report /path/to/private-repo
```

### Q2: 如何排除某些文件？
A: 在配置文件中设置：
```javascript
module.exports = {
  excludePaths: [
    "node_modules",
    "*.min.js",
    "dist",
    "build",
    "*.log"
  ]
};
```

### Q3: 如何处理大仓库？
A: 使用时间范围限制：
```bash
git-report --since "2023-01-01" --until "2023-06-30"
```

### Q4: 如何自定义报告模板？
A: 可以修改 `src/templates/` 目录下的模板文件，或使用自定义模板：
```javascript
module.exports = {
  template: "./my-custom-template.html"
};
```

## 高级用法

### 1. 自动化脚本
创建 `generate-report.sh`:
```bash
#!/bin/bash
YEAR=$(date +%Y)
OUTPUT_DIR="./reports/$YEAR"

mkdir -p $OUTPUT_DIR

# 生成年度报告
git-report --year $YEAR --output $OUTPUT_DIR --format html,pdf

# 生成月度报告
for month in {01..12}; do
  git-report --since "$YEAR-$month-01" --until "$YEAR-$month-31" \
    --output "$OUTPUT_DIR/monthly/$YEAR-$month" --no-interactive
done

echo "报告生成完成: $OUTPUT_DIR"
```

### 2. 集成到CI/CD
```yaml
# .github/workflows/yearly-report.yml
name: Generate Yearly Report
on:
  schedule:
    - cron: '0 0 31 12 *'  # 每年12月31日
  workflow_dispatch:

jobs:
  generate-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'

      - name: Install dependencies
        run: npm install -g personal-git-report

      - name: Generate report
        run: git-report --year $(date +%Y) --output ./reports

      - name: Upload reports
        uses: actions/upload-artifact@v2
        with:
          name: yearly-report
          path: ./reports/
```

### 3. 自定义分析
```javascript
// custom-analysis.js
const { GitAnalyzer } = require('personal-git-report');

async function customAnalysis() {
  const analyzer = new GitAnalyzer({
    repositoryPath: './',
    since: '2023-01-01',
    until: '2023-12-31'
  });

  const result = await analyzer.analyze();

  // 自定义数据处理
  console.log('最活跃的小时:', findMostActiveHour(result.timeStats.byHour));
  console.log('最常用的语言:', getTopLanguage(result.languageStats));

  // 生成自定义报告
  generateCustomReport(result);
}

customAnalysis();
```

这些示例展示了Personal Git Report的各种使用方式，从简单的命令行使用到复杂的自动化集成，满足不同场景的需求。
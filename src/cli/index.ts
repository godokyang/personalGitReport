#!/usr/bin/env node

/**
 * Personal Git Report 命令行工具
 * 提供简单易用的CLI接口
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { GitAnalyzer, GitAnalyzerOptions } from '../analyzer/GitAnalyzer';
import { ReportGenerator, ReportOptions } from '../report/ReportGenerator';
import { ConfigManager, GitReportConfig } from '../utils/ConfigManager';

const program = new Command();

/**
 * 主程序入口
 */
async function main() {
  program
    .name('git-report')
    .description('🌟 打造属于你的年度编程回顾报告')
    .version('1.0.0');

  // 基础命令
  program
    .argument('[path]', '要分析的Git仓库路径', process.cwd())
    .option('-y, --year <year>', '指定年份（最近三年）', new Date().getFullYear().toString())
    .option('-t, --theme <theme>', '主题 (light/dark/colorful)', 'dark')
    .option('-f, --format <format>', '输出格式 (html/json/pdf)', 'html')
    .option('-o, --output <path>', '输出目录', './reports')
    .option('-a, --author <email>', '指定作者邮箱（单个，向后兼容）')
    .option('--authors <emails>', '指定多个作者邮箱，用逗号分隔')
    .option('--repos-dir <path>', '多仓库目录，自动扫描该目录下的所有Git仓库')
    .option('-c, --config <path>', '配置文件路径')
    .option('--no-interactive', '非交互模式')
    .action(async (repoPath: string, options) => {
      try {
        await generateReport(repoPath, options);
      } catch (error) {
        console.error(chalk.red('❌ 生成报告失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 多项目分析命令
  program
    .command('multi')
    .description('分析多个项目')
    .option('-p, --projects <paths>', '项目路径列表，用逗号分隔')
    .option('-y, --year <year>', '指定年份', new Date().getFullYear().toString())
    .option('-t, --theme <theme>', '主题 (light/dark/colorful)', 'dark')
    .option('-f, --format <format>', '输出格式 (html/json/pdf)', 'html')
    .option('-o, --output <path>', '输出目录', './reports')
    .option('-c, --config <path>', '配置文件路径')
    .action(async (options) => {
      try {
        await generateMultipleReports(options);
      } catch (error) {
        console.error(chalk.red('❌ 生成报告失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 初始化配置命令
  program
    .command('init')
    .description('创建示例配置文件')
    .option('-o, --output <path>', '配置文件输出路径', './git-report.config.js')
    .action(async (options) => {
      try {
        await ConfigManager.createSampleConfig(options.output);
      } catch (error) {
        console.error(chalk.red('❌ 创建配置文件失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program.parse();
}

/**
 * 检查路径是否为Git仓库
 */
function isGitRepository(dirPath: string): boolean {
  const gitPath = path.join(dirPath, '.git');
  return fs.existsSync(gitPath);
}

/**
 * 生成单个项目报告
 */
async function generateReport(repoPath: string, options: any): Promise<void> {
  console.log(chalk.blue.bold('🚀 Personal Git Report - 年度编程报告生成器'));
  console.log('');

  // 解析参数
  const year = ConfigManager.parseYear(options.year);
  const resolvedPath = path.resolve(repoPath);

  // 检查是否为Git仓库，如果不是则扫描子目录
  let repositoriesToAnalyze: string[] = [];
  if (isGitRepository(resolvedPath)) {
    // 指定的路径是Git仓库，直接分析
    repositoriesToAnalyze = [resolvedPath];
    console.log(chalk.blue(`📁 分析Git仓库: ${chalk.cyan(resolvedPath)}`));
  } else {
    // 指定的路径不是Git仓库，扫描子目录查找所有Git仓库
    console.log(chalk.blue(`🔍 目录 ${chalk.cyan(resolvedPath)} 不是Git仓库，正在扫描子目录...`));
    repositoriesToAnalyze = ConfigManager.getRepositoryPaths(resolvedPath, true, 3);

    if (repositoriesToAnalyze.length === 0) {
      console.error(chalk.red(`❌ 在 ${resolvedPath} 及其子目录中未找到任何Git仓库`));
      return;
    }

    console.log(chalk.green(`✅ 找到 ${repositoriesToAnalyze.length} 个Git仓库`));
    console.log(chalk.blue('📋 仓库列表:'));
    repositoriesToAnalyze.forEach((repo, idx) => {
      console.log(`  ${idx + 1}. ${chalk.cyan(path.basename(repo))} - ${repo}`);
    });
  }
  console.log('');

  // 加载配置
  const config = await ConfigManager.loadConfig(options.config);

  // 处理多账户参数
  let authors = config.authors || [];
  if (options.authors) {
    authors = options.authors.split(',').map((a: string) => a.trim());
  } else if (options.author) {
    authors = [options.author];
  }

  // 命令行参数覆盖配置文件
  const finalConfig = {
    ...config,
    theme: options.theme || config.theme,
    format: [options.format],
    output: options.output || config.output,
    authors: authors.length > 0 ? authors : undefined,
    repositoriesDir: options.reposDir || config.repositoriesDir,
  };

  // 验证配置
  const validation = ConfigManager.validateConfig(finalConfig);
  if (!validation.valid) {
    console.error(chalk.red('❌ 配置验证失败:'));
    validation.errors.forEach(error => console.error(chalk.red(`  - ${error}`)));
    return;
  }

  // 交互式配置（如果启用）
  if (options.interactive !== false) {
    await interactiveConfig(finalConfig, resolvedPath, year);
  }

  // 处理额外的多仓库目录扫描（通过配置文件指定）
  if (finalConfig.repositoriesDir && repositoriesToAnalyze.length === 1 && isGitRepository(repositoriesToAnalyze[0])) {
    console.log(chalk.blue(`🔍 扫描配置的多仓库目录: ${finalConfig.repositoriesDir}`));
    repositoriesToAnalyze = ConfigManager.getRepositoryPaths(finalConfig.repositoriesDir, true, 3);
    console.log(chalk.green(`✅ 找到 ${repositoriesToAnalyze.length} 个Git仓库`));
    if (repositoriesToAnalyze.length > 0) {
      console.log(chalk.blue('📋 仓库列表:'));
      repositoriesToAnalyze.forEach((repo, idx) => {
        console.log(`  ${idx + 1}. ${chalk.cyan(path.basename(repo))} - ${repo}`);
      });
    }
    console.log('');
  }

  // 显示配置信息
  console.log(chalk.blue('📋 配置信息:'));
  if (repositoriesToAnalyze.length === 1) {
    console.log(`  📁 项目路径: ${chalk.cyan(repositoriesToAnalyze[0])}`);
  } else {
    console.log(`  📁 项目数量: ${chalk.cyan(repositoriesToAnalyze.length)}`);
  }
  console.log(`  📅 分析年份: ${chalk.cyan(year)}`);
  console.log(`  🎨 主题风格: ${chalk.cyan(finalConfig.theme)}`);
  console.log(`  📄 输出格式: ${chalk.cyan(finalConfig.format.join(', '))}`);
  console.log(`  📂 输出目录: ${chalk.cyan(finalConfig.output)}`);
  if (finalConfig.authors && finalConfig.authors.length > 0) {
    console.log(`  👤 筛选账户: ${chalk.cyan(finalConfig.authors.join(', '))}`);
  }
  console.log('');

  // 分析所有仓库
  const analysisResults: Array<{
    result: any;
    projectPath: string;
    projectName: string;
  }> = [];

  for (let i = 0; i < repositoriesToAnalyze.length; i++) {
    const currentRepoPath = repositoriesToAnalyze[i];
    const repoName = path.basename(currentRepoPath);

    if (repositoriesToAnalyze.length > 1) {
      console.log(chalk.blue(`\n📊 分析仓库 ${i + 1}/${repositoriesToAnalyze.length}: ${repoName}`));
    }

    // 开始分析
    const spinner = ora('🔍 正在分析Git仓库...').start();

    try {
      // 设置Git分析器选项
      const analyzerOptions: GitAnalyzerOptions = {
        repositoryPath: currentRepoPath,
        authors: finalConfig.authors,
        includeMerges: finalConfig.includeMerges,
        excludePaths: finalConfig.excludePaths,
        since: finalConfig.dateRange?.from,
        until: finalConfig.dateRange?.to,
      };

      // 如果没有指定日期范围，按年份分析
      if (!analyzerOptions.since && !analyzerOptions.until) {
        analyzerOptions.since = `${year}-01-01`;
        analyzerOptions.until = `${year}-12-31`;
      }

      // 执行Git分析
      const analyzer = new GitAnalyzer(analyzerOptions);
      const analysisResult = await analyzer.analyze();

      spinner.succeed('✅ Git仓库分析完成！');

      // 保存分析结果
      analysisResults.push({
        result: analysisResult,
        projectPath: currentRepoPath,
        projectName: repoName,
      });

    } catch (error) {
      spinner.fail('❌ 分析失败');
      console.error(chalk.red(`  错误: ${error instanceof Error ? error.message : String(error)}`));
      if (repositoriesToAnalyze.length > 1) {
        console.log(chalk.yellow('  跳过此仓库，继续分析下一个...'));
        continue;
      } else {
        throw error;
      }
    }
  }

  // 生成汇总报告
  if (repositoriesToAnalyze.length > 1) {
    // 多项目：生成汇总报告
    console.log(chalk.blue(`\n📊 正在生成 ${analysisResults.length} 个项目的汇总报告...`));
    const mergeSpinner = ora('🔗 正在合并分析数据...').start();

    try {
      // 导入合并方法
      const { GitAnalyzer } = await import('../analyzer/GitAnalyzer');
      const mergedResult = GitAnalyzer.mergeAnalysisResults(analysisResults);

      mergeSpinner.succeed('✅ 数据合并完成！');

      // 生成汇总报告
      const reportSpinner = ora('📄 正在生成汇总报告...').start();

      const reportOptions: ReportOptions = {
        outputPath: finalConfig.output,
        theme: finalConfig.theme,
        format: finalConfig.format[0] as 'html' | 'json' | 'pdf',
        author: finalConfig.author || '多项目分析',
        year: year,
      };

      const reportGenerator = new ReportGenerator(mergedResult, reportOptions);
      const reportPath = await reportGenerator.generate();

      reportSpinner.succeed('✅ 汇总报告生成完成！');

      // 显示汇总结果
      console.log('');
      console.log(chalk.green.bold('🎉 多项目汇总报告生成成功！'));
      console.log('');
      console.log(chalk.blue('📊 项目统计:'));

      const activeProjects = mergedResult.projectDetails.filter(p => p.active);
      const inactiveProjects = mergedResult.projectDetails.filter(p => !p.active);

      console.log(`  🔥 活跃项目: ${chalk.yellow(activeProjects.length)} 个`);
      console.log(`  💤 静态项目: ${chalk.yellow(inactiveProjects.length)} 个`);
      console.log('');

      if (activeProjects.length > 0) {
        console.log(chalk.blue('💻 活跃项目列表:'));
        activeProjects.slice(0, 10).forEach((project, idx) => {
          const rank = idx + 1;
          const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
          console.log(`  ${emoji} ${chalk.cyan(project.name)}: ${chalk.yellow(project.commits)} 次提交, ${chalk.yellow('+' + project.lines)} 行`);
        });

        if (activeProjects.length > 10) {
          console.log(`     ... 还有 ${activeProjects.length - 10} 个项目`);
        }
        console.log('');
      }

      console.log(chalk.blue('📈 汇总统计:'));
      console.log(`  📝 总提交数: ${chalk.yellow(mergedResult.totalCommits.toLocaleString())}`);
      console.log(`  💻 新增代码: ${chalk.yellow('+' + mergedResult.totalInsertions.toLocaleString())} 行`);
      console.log(`  🗑️ 删除代码: ${chalk.yellow('-' + mergedResult.totalDeletions.toLocaleString())} 行`);
      console.log(`  📈 净增长: ${chalk.yellow(mergedResult.netLines.toLocaleString())} 行`);
      console.log(`  🔥 最长连续: ${chalk.yellow(mergedResult.streakStats.longestStreak)} 天`);
      console.log(`  🎯 技术栈: ${chalk.yellow(Array.from(mergedResult.languageStats.keys()).slice(0, 5).join(', '))}`);
      console.log('');
      console.log(chalk.blue('📄 报告文件:'));
      console.log(`  📂 ${chalk.cyan(reportPath)}`);
      console.log('');

    } catch (error) {
      mergeSpinner.fail('❌ 汇总失败');
      console.error(chalk.red(`错误: ${error instanceof Error ? error.message : String(error)}`));
    }

    console.log(chalk.green.bold('\n🌟 所有仓库分析完成！'));
  } else {
    // 单项目：生成单个报告
    const singleResult = analysisResults[0];
    const reportSpinner = ora('📊 正在生成年度报告...').start();

    try {
      const reportOptions: ReportOptions = {
        outputPath: finalConfig.output,
        theme: finalConfig.theme,
        format: finalConfig.format[0] as 'html' | 'json' | 'pdf',
        author: finalConfig.author || singleResult.projectName,
        year: year,
      };

      const reportGenerator = new ReportGenerator(singleResult.result, reportOptions);
      const reportPath = await reportGenerator.generate();

      reportSpinner.succeed('✅ 年度报告生成完成！');

      // 显示结果
      console.log('');
      console.log(chalk.green.bold('🎉 报告生成成功！'));
      console.log('');
      console.log(chalk.blue('📊 统计摘要:'));
      console.log(`  📝 总提交数: ${chalk.yellow(singleResult.result.totalCommits.toLocaleString())}`);
      console.log(`  💻 新增代码: ${chalk.yellow('+' + singleResult.result.totalInsertions.toLocaleString())} 行`);
      console.log(`  🗑️ 删除代码: ${chalk.yellow('-' + singleResult.result.totalDeletions.toLocaleString())} 行`);
      console.log(`  📈 净增长: ${chalk.yellow(singleResult.result.netLines.toLocaleString())} 行`);
      console.log(`  🔥 最长连续: ${chalk.yellow(singleResult.result.streakStats.longestStreak)} 天`);
      console.log(`  🎯 技术栈: ${chalk.yellow(Array.from(singleResult.result.languageStats.keys()).slice(0, 3).join(', '))}`);
      console.log('');
      console.log(chalk.blue('📄 报告文件:'));
      console.log(`  📂 ${chalk.cyan(reportPath)}`);
      console.log('');

    } catch (error) {
      reportSpinner.fail('❌ 报告生成失败');
      console.error(chalk.red(`错误: ${error instanceof Error ? error.message : String(error)}`));
    }

    console.log(chalk.green('🌟 快去分享你的年度编程成就吧！'));
  }
}

/**
 * 生成多个项目报告
 */
async function generateMultipleReports(options: any): Promise<void> {
  console.log(chalk.blue.bold('🚀 Personal Git Report - 多项目分析模式'));
  console.log('');

  if (!options.projects) {
    console.error(chalk.red('❌ 请指定要分析的项目路径'));
    console.log(chalk.yellow('💡 使用示例: git-report multi --projects "/proj1,/proj2,/proj3"'));
    return;
  }

  const projectPaths = options.projects.split(',').map((p: string) => path.resolve(p.trim()));
  const year = ConfigManager.parseYear(options.year);

  console.log(chalk.blue('📋 将分析以下项目:'));
  projectPaths.forEach((p: string, i: number) => {
    console.log(`  ${i + 1}. ${chalk.cyan(p)}`);
  });
  console.log('');

  // 为每个项目生成报告
  for (let i = 0; i < projectPaths.length; i++) {
    const projectPath = projectPaths[i];
    console.log(chalk.blue(`🔍 分析项目 ${i + 1}/${projectPaths.length}: ${path.basename(projectPath)}`));

    try {
      // 创建项目专用的输出目录
      const projectName = path.basename(projectPath);
      const projectOutput = path.join(options.output, projectName);

      // 设置分析选项
      const analyzerOptions: GitAnalyzerOptions = {
        repositoryPath: projectPath,
        includeMerges: false,
        since: `${year}-01-01`,
        until: `${year}-12-31`,
      };

      // 执行分析
      const analyzer = new GitAnalyzer(analyzerOptions);
      const analysisResult = await analyzer.analyze();

      // 生成报告
      const reportOptions: ReportOptions = {
        outputPath: projectOutput,
        theme: options.theme,
        format: options.format,
        author: path.basename(projectPath),
        year: year,
      };

      const reportGenerator = new ReportGenerator(analysisResult, reportOptions);
      await reportGenerator.generate();

      console.log(chalk.green(`✅ 项目 ${projectName} 报告生成完成`));

    } catch (error) {
      console.error(chalk.red(`❌ 项目 ${path.basename(projectPath)} 分析失败: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log('');
  }

  console.log(chalk.green.bold('🎉 所有项目分析完成！'));
}

/**
 * 交互式配置
 */
async function interactiveConfig(config: GitReportConfig, repoPath: string, currentYear: number): Promise<void> {
  console.log(chalk.blue('🎯 交互式配置 (按Enter使用默认值)'));
  console.log('');

  const availableYears = ConfigManager.getAvailableYears();

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'year',
      message: '选择分析年份:',
      choices: availableYears.map(y => ({
        name: y === currentYear ? `${y} (当前年份)` : y.toString(),
        value: y,
      })),
      default: currentYear,
    },
    {
      type: 'input',
      name: 'author',
      message: '显示在报告中的名字:',
      default: config.author || path.basename(repoPath),
    },
    {
      type: 'input',
      name: 'authors',
      message: '筛选账户 (多个邮箱/用户名用逗号分隔):',
      default: config.authors ? config.authors.join(', ') : '',
    },
    {
      type: 'list',
      name: 'theme',
      message: '选择主题风格:',
      choices: [
        { name: '🌙 暗黑主题', value: 'dark' },
        { name: '☀️ 明亮主题', value: 'light' },
        { name: '🌈 彩色主题', value: 'colorful' },
      ],
      default: config.theme,
    },
    {
      type: 'checkbox',
      name: 'format',
      message: '选择输出格式:',
      choices: [
        { name: '📄 HTML (推荐)', value: 'html', checked: true },
        { name: '📋 JSON 数据', value: 'json' },
        { name: '📕 PDF 报告', value: 'pdf' },
      ],
    },
    {
      type: 'input',
      name: 'output',
      message: '输出目录:',
      default: config.output,
    },
  ]);

  // 更新配置
  config.author = answers.author;
  config.theme = answers.theme;
  config.format = answers.format;
  config.output = answers.output;
  
  // 处理多账户输入
  if (answers.authors && answers.authors.trim()) {
    config.authors = answers.authors.split(',').map((a: string) => a.trim()).filter((a: string) => a);
  }

  console.log('');
}

// 启动程序
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('💥 程序异常退出:'), error);
    process.exit(1);
  });
}
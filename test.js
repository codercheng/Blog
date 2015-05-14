
<!doctype html>
<html dir="ltr" lang="zh-CN">
<head>
	<meta charset="utf-8">
	<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">

	<title>从Apache Kafka 重温文件高效读写 | 花钱的年华</title>

	<link rel="alternate" type="application/rss+xml" title="All Categories Feed" href="/feed">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">

	<!-- Pingback -->
	<link rel="pingback" href="http://calvin1978.blogcn.com/xmlrpc.php">
	
	<link rel="alternate" type="application/rss+xml" title="花钱的年华 &raquo; 从Apache Kafka 重温文件高效读写 评论订阅" href="http://calvin1978.blogcn.com/articles/kafkaio.html/feed" />
<link rel='stylesheet' id='main-css'  href='http://utheme.blogcn.com/wp-content/user-themes/4/f6/8bbb23eb9879ee3d/style.css?ver=1421039676?ver=3.0' type='text/css' media='all' />
<script type='text/javascript' src='http://static.blogcn.com/wp-includes/js/jquery/jquery.js?ver=1.4.2'></script>
<script type='text/javascript' src='http://utheme.blogcn.com/wp-content/user-themes/4/f6/8bbb23eb9879ee3d/js/scripts.js?ver=3.0'></script>
<script type='text/javascript' src='http://static.blogcn.com/wp-includes/js/comment-reply.js?ver=20090102'></script>
<link rel="EditURI" type="application/rsd+xml" title="RSD" href="http://calvin1978.blogcn.com/xmlrpc.php?rsd" />
<link rel="wlwmanifest" type="application/wlwmanifest+xml" href="http://static.blogcn.com/wp-includes/wlwmanifest.xml" /> 
<link rel='index' title='花钱的年华' href='http://calvin1978.blogcn.com' />
<link rel='start' title='在复活节的打扫' href='http://calvin1978.blogcn.com/articles/%e6%89%93%e6%89%ab.html' />
<link rel='prev' title='我的后端开发书架2015' href='http://calvin1978.blogcn.com/articles/bookshelf.html' />
<link rel='next' title='Flickr前端工程师的情怀' href='http://calvin1978.blogcn.com/articles/flickr.html' />
<meta name="generator" content="WordPress 3.0" />
<link rel='canonical' href='http://calvin1978.blogcn.com/articles/kafkaio.html' />
<link rel='shortlink' href='http://calvin1978.blogcn.com/?p=1548' />

<!-- all in one seo pack 1.4.7.4 [149,216] -->
<meta name="description" content="卡夫卡说：不要害怕文件系统。 它就那么简简单单地用顺序写的普通文件，借力于Linux内核的Page Cache，不(显式)用内存，胜用内存，完全没有别家那样要同时维护内存中数据、持久化数据的烦恼——只要内存足够，生产者与消费者的速度也没有差上太多，读写便都发生在Page Cache中，完全没有同步的磁盘访问。 这里就借着Apache Kafka的由头，将Page Cache层与IO调度层重温一遍。" />
<!-- /all in one seo pack -->
<script language="javascript" src="http://calvin1978.blogcn.com/wp-content/plugins/statpresscn/statpresscn.php?q=%2Farticles%2Fkafkaio.html&rs=200&r=&r_2P=%5B%22post%22%2C%221548%22%5D"></script></head>

<body class="single single-post postid-1548">

<div id="container">
	
	<header>
		<hgroup class="clearfix">
			<h1><a href="http://calvin1978.blogcn.com" title="Home">花钱的年华</a></h1>
			<h2>江南白衣，春天的旁边</h2>
		</hgroup>
	</header>
	<div id="content" class="clearfix">
		
		<section id="posts">

							
					<article id="post-1548" class="post first">
					
						<header>
							<h1>从Apache Kafka 重温文件高效读写</h1>
							<p><time datetime="2015-05-02T12:33:32+00:00">05月 2, 2015</time> | <span class="categories">Filed under <a href="http://calvin1978.blogcn.com/articles/category/%e6%8a%80%e6%9c%af" title="查看 技术 中所有日志" rel="category tag">技术</a></span></p>
						</header>
						
						<div class="entry-content">
							<h3>0. Overview</h3>
<p>卡夫卡说：<a href="http://kafka.apache.org/documentation.html#persistence">不要害怕文件系统</a>。</p>
<p>它就那么简简单单地用顺序写的普通文件，借力于Linux内核的Page Cache，不(显式)用内存，胜用内存，完全没有别家那样要同时维护内存中数据、持久化数据的烦恼——只要内存足够，生产者与消费者的速度也没有差上太多，读写便都发生在Page Cache中，完全没有同步的磁盘访问。</p>
<p>整个IO过程，从上到下分成文件系统层(VFS+ ext3)、 Page Cache 层、通用数据块层、 IO调度层、块设备驱动层。 这里借着Apache Kafka的由头，将Page Cache层与IO调度层重温一遍，记一篇针对Linux kernel 2.6的科普文。</p>
<p>&nbsp;</p>
<h3>1. Page Cache</h3>
<h4>1.1 读写空中接力</h4>
<p>Linux总会把系统中还没被应用使用的内存挪来给Page Cache，在命令行输入free，或者cat /proc/meminfo，"Cached"的部分就是Page Cache。</p>
<p>Page Cache中每个文件是一棵Radix树(基树)，节点由4k大小的Page组成，可以通过文件的偏移量快速定位Page。</p>
<p>当写操作发生时，它只是将数据写入Page Cache中，并将该页置上dirty标志。</p>
<p>当读操作发生时，它会首先在Page Cache中查找内容，如果有就直接返回了，没有的话就会从磁盘读取文件再写回Page Cache。</p>
<p>可见，只要生产者与消费者的速度相差不大，消费者会直接读取之前生产者写入Page Cache的数据，大家在内存里完成接力，根本没有磁盘访问。</p>
<p>而比起在内存中维护一份消息数据的传统做法，这既不会重复浪费一倍的内存，Page Cache又不需要GC(可以放心使用60G内存了)，而且即使Kafka重启了，Page Cache还依然在。</p>
<p>&nbsp;</p>
<h4>1.2 后台异步flush的策略</h4>
<p>这是大家最需要关心的，因为不能及时flush的话，OS crash(不是应用crash) 可能引起数据丢失，Page Cache瞬间从朋友变魔鬼。</p>
<p>当然，Kafka不怕丢，因为它的持久性是靠replicate保证，重启后会从原来的replicate follower中拉缺失的数据。</p>
<p>内核线程pdflush负责将有dirty标记的页面，发送给IO调度层。内核会为每个磁盘起一条pdflush线程，每5秒（/proc/sys/vm/dirty_writeback_centisecs）唤醒一次，根据下面三个参数来决定行为：</p>
<p>1. 如果page dirty的时间超过了30秒(/proc/sys/vm/dirty_expire_centiseconds，单位是百分之一秒)，就会被刷到磁盘，所以crash时最多丢30秒左右的数据。</p>
<p>2. 如果dirty page的总大小已经超过了10%(/proc/sys/vm/dirty_background_ratio)的可用内存(cat /proc/meminfo里 MemFree+ Cached - Mapped)，则会在后台启动pdflush 线程写盘，但不影响当前的write(2)操作。增减这个值是最主要的flush策略里调优手段。</p>
<p>3. 如果wrte(2)的速度太快，比pdflush还快，dirty page 迅速涨到 20%(/proc/sys/vm/dirty_ratio)的总内存(cat /proc/meminfo里的MemTotal)，则此时所有应用的写操作都会被block，各自在自己的时间片里去执行flush，因为操作系统认为现在已经来不及写盘了，如果crash会丢太多数据，要让大家都冷静点。这个代价有点大，要尽量避免。在Redis2.8以前，Rewrite AOF就经常导致这个大面积阻塞，现在已经改为Redis每32Mb先主动flush()一下了。</p>
<p>详细的文章可以看： <a href="http://www.westnet.com/~gsmith/content/linux-pdflush.htm">The Linux Page Cache and pdflush</a><br>
&nbsp;</p>
<h4>1.3 主动flush的方式</h4>
<p>对于重要数据，应用需要自己触发flush保证写盘。</p>
<p>1. 系统调用fsync() 和 fdatasync()</p>
<p>fsync(fd)将属于该文件描述符的所有dirty page的写入请求发送给IO调度层。</p>
<p>fsync()总是同时flush文件内容与文件元数据， 而fdatasync()只flush文件内容与后续操作必须的文件元数据。元数据含时间戳，大小等，大小可能是后续操作必须，而时间戳就不是必须的。因为文件的元数据保存在另一个地方，所以fsync()总是触发两次IO，性能要差一点。</p>
<p>2. 打开文件时设置O_SYNC，O_DSYNC标志或O_DIRECT标志</p>
<p>O_SYNC、O_DSYNC标志表示每次write后要等到flush完成才返回，效果等同于write()后紧接一个fsync()或fdatasync()，不过按APUE里的测试，因为OS做了优化，性能会比自己调write() + fsync()好一点，但与只是write相比就慢很多了。</p>
<p>O_DIRECT标志表示直接IO，完全跳过Page Cache。不过这也放弃了读文件时的Cache，必须每次读取磁盘文件。而且要求所有IO请求长度，偏移都必须是底层扇区大小的整数倍。所以使用直接IO的时候一定要在应用层做好Cache。<br>
&nbsp;</p>
<h4>1.4 Page Cache的清理策略</h4>
<p>当内存满了，就需要清理Page Cache，或把应用占的内存swap到文件去。有一个swappiness的参数(/proc/sys/vm/swappiness)决定是swap还是清理page cache，值在0到100之间，设为0表示尽量不要用swap，这也是很多优化指南让你做的事情，因为默认值居然是60，Linux认为Page Cache更重要。</p>
<p>Page Cache的清理策略是LRU的升级版。如果简单用LRU，一些新读出来的但可能只用一次的数据会占满了LRU的头端。因此将原来一条LRU队列拆成了两条，一条放新的Page，一条放已经访问过好几次的Page。Page刚访问时放在新LRU队列里，访问几轮了才升级到旧LRU队列(想想JVM Heap的新生代老生代)。清理时就从新LRU队列的尾端开始清理，直到清理出足够的内存。</p>
<p>&nbsp;</p>
<h4>1.5 预读策略</h4>
<p>根据清理策略，Apache Kafka里如果消费者太慢，堆积了几十G的内容，Cache还是会被清理掉的。这时消费者就需要读盘了。</p>
<p>内核这里又有个动态自适应的预读策略，每次读请求会尝试预读更多的内容(反正都是一次读操作)。内核如果发现一个进程一直使用预读数据，就会增加预读窗口的大小(最小16K，最大128K)，否则会关掉预读窗口。连续读的文件，明显适合预读。</p>
<p>&nbsp;</p>
<h3>2. IO调度层</h3>
<p>如果所有读写请求都直接发给硬盘，对传统硬盘来说太残忍了。IO调度层主要做两个事情，合并和排序。 合并是将相同和相邻扇区(每个512字节)的操作合并成一个，比如我现在要读扇区1，2，3，那可以合并成一个读扇区1-3的操作。排序就是将所有操作按扇区方向排成一个队列，让磁盘的磁头可以按顺序移动，有效减少了机械硬盘寻址这个最慢最慢的操作。</p>
<p>排序看上去很美，但可能造成严重的不公平，比如某个应用在相邻扇区狂写盘，其他应用就都干等在那了，pdflush还好等等没所谓，读请求都是同步的，耗在那会很惨。</p>
<p>所有又有多种算法来解决这个问题，其中内核2.6的默认算法是CFQ(完全公正排队)，把总的排序队列拆分成每个发起读写的进程自己有一条排序队列，然后以时间片轮转调度每个队列，轮流从每个进程的队列里拿出若干个请求来执行(默认是4）。</p>
<p>在Apache Kafka里，消息的读写都发生在内存中，真正写盘的就是那条pdflush内核线程，因为都是顺序写，即使一台服务器上有多个Partition文件，经过合并和排序后都能获得很好的性能，或者说，Partition文件的个数并不影响性能，不会出现文件多了变成随机读写的情况。</p>
<p>如果是SSD硬盘，没有寻址的花销，排序好像就没必要了，但合并的帮助依然良多，所以还有另一种只合并不排序的NOOP算法可供选择。</p>
<h3>题外话</h3>
<p>另外，硬盘上还有一块几十M的缓存，硬盘规格上的外部传输速率(总线到缓存)与内部传输速率(缓存到磁盘)的区别就在此......IO调度层以为已经写盘了，其实可能依然没写成，断电的话靠硬盘上的电池或大电容保命......</p>
<p>延伸阅读：<a href="http://tech.meituan.com/kafka-fs-design-theory.html">Kafka文件存储机制那些事</a> by 美团技术团队</p>
<p>&nbsp;<br>
文章持续修订，转载请保留原链接： <a href="http://calvin1978.blogcn.com/articles/kafkaio.html">http://calvin1978.blogcn.com/articles/kafkaio.html</a></p>

													</div>
						
						<footer>
							<span class="vcard author">by calvin</span> |
							<span class="tags">tags : </span> |
							<span class="comments"><a href="http://calvin1978.blogcn.com/articles/kafkaio.html#comments">0</a></span>
							
							<nav class="pager">
								<ul>
									<li><a href="http://calvin1978.blogcn.com/articles/flickr.html" rel="next">Flickr前端工程师的情怀</a> &raquo;</li>
									<li>&laquo; <a href="http://calvin1978.blogcn.com/articles/bookshelf.html" rel="prev">我的后端开发书架2015</a></li>
								</ul>
							</nav>
							
							<p>
																	You can 									<a href="#respond">leave a response</a>
									, or 									<a href="http://calvin1978.blogcn.com/articles/kafkaio.html/trackback" rel="trackback">
									trackback</a>
									from your own site.								<span id="_e_p_1548" style="display:none"><a class="post-edit-link" href="http://calvin1978.blogcn.com/wp-admin/post.php?action=edit&post=1548" title="编辑日志">Edit this entry</a>.</span><script language="javascript">if(document.cookie.indexOf("wp-settings")!=-1)document.getElementById("_e_p_1548").style.display='';</script>							</p>
							
						</footer>

						

			<!-- [comments are open, but there are no comments] -->
			
	 

		<section id="respond">

			
											<div id="respond">
				<h3 id="reply-title">发表评论 <small><a rel="nofollow" id="cancel-comment-reply-link" href="/articles/kafkaio.html#respond" style="display:none;">取消回复</a></small></h3>
									<form action="http://calvin1978.blogcn.com/wp-comments-post.php" method="post" id="commentform">
																			<p class="comment-notes">您的电子邮箱不会被公开。</p>							<p class="comment-form-author"><label for="author">名称</label> <input id="author" name="author" type="text" value="" size="30" /></p>
<p class="comment-form-email"><label for="email">电子邮箱</label> <input id="email" name="email" type="text" value="" size="30" /></p>
<p class="comment-form-url"><label for="url">网址</label><input id="url" name="url" type="text" value="" size="30" /></p>
												<p class="comment-form-comment"><label for="comment">评论</label><textarea id="comment" name="comment" cols="45" rows="8" aria-required="true"></textarea></p>						<p class="form-allowed-tags">您可以使用这些 <abbr title="HyperText Markup Language">HTML</abbr> 标签和属性： <code>&lt;a href=&quot;&quot; title=&quot;&quot;&gt; &lt;abbr title=&quot;&quot;&gt; &lt;acronym title=&quot;&quot;&gt; &lt;b&gt; &lt;blockquote cite=&quot;&quot;&gt; &lt;cite&gt; &lt;code&gt; &lt;del datetime=&quot;&quot;&gt; &lt;em&gt; &lt;i&gt; &lt;q cite=&quot;&quot;&gt; &lt;strike&gt; &lt;strong&gt; </code></p>						<p class="form-submit">
							<input name="submit" type="submit" id="submit" value="发表评论" />
							<input type='hidden' name='comment_post_ID' value='1548' id='comment_post_ID' />
<input type='hidden' name='comment_parent' id='comment_parent' value='0' />
						</p>
											</form>
							</div><!-- #respond -->
									 
			
		</section>
						
					</article>
	
					
							
		</section>

<!-- empty -->
	</div>
	
</div> <!-- end of #container -->

<aside id="footer" class="clearfix">

	<div class="inner clearfix">
		<div class="first column">
				
				<section class="widget">
					<h3>分类</h3>
					
<nav class="main"><ul>	<li class="cat-item cat-item-66"><a href="http://calvin1978.blogcn.com/articles/category/%e5%b7%a5%e4%bd%9c" title="查看工作下的所有日志">工作</a>
</li>
	<li class="cat-item cat-item-64"><a href="http://calvin1978.blogcn.com/articles/category/%e6%8a%80%e6%9c%af" title="查看技术下的所有日志">技术</a>
</li>
	<li class="cat-item cat-item-3"><a href="http://calvin1978.blogcn.com/articles/category/%e6%96%87%e8%89%ba" title="查看文艺下的所有日志">文艺</a>
</li>
	<li class="cat-item cat-item-1"><a href="http://calvin1978.blogcn.com/articles/category/%e6%97%a5%e5%b8%b8" title="查看日常下的所有日志">日常</a>
</li>
	<li class="cat-item cat-item-65"><a href="http://calvin1978.blogcn.com/articles/category/%e8%ae%ae%e8%ae%ba" title="查看议论下的所有日志">议论</a>
</li>
</ul></nav>
				</section>
				<section class="widget">
<h3>链接</h3>
<nav>
					<ul>
						<li><a href="/feed">RSS</a></li>
						<li><a href="http://www.weibo.com/calvin1978" rel="me" target="_blank">我的微博</a></li>
<li><a href="http://springside.io/" rel="me" target="_blank">春天的旁边</a></li>
					</ul>
</nav>
</section>
		</div>
		
		<div class="second column">
				
				<section class="widget">
					<h3>归档</h3>
					<nav>
					<ul>
					  	<li><a href='http://calvin1978.blogcn.com/articles/2015/05' title='2015年05月'>2015年05月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2015/04' title='2015年04月'>2015年04月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2015/03' title='2015年03月'>2015年03月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2015/02' title='2015年02月'>2015年02月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2015/01' title='2015年01月'>2015年01月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/12' title='2014年12月'>2014年12月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/11' title='2014年11月'>2014年11月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/10' title='2014年10月'>2014年10月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/09' title='2014年09月'>2014年09月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/08' title='2014年08月'>2014年08月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/07' title='2014年07月'>2014年07月</a></li>
	<li><a href='http://calvin1978.blogcn.com/articles/2014/06' title='2014年06月'>2014年06月</a></li>
					</ul>
                                        </nav>
				</section>
			
		</div>

		<div class="third column">
			
<section class="widget">
					<h3>标签云</h3>
					<p>
						<a href='http://calvin1978.blogcn.com/articles/tag/aboutme' class='tag-link-83' title='1 篇主题' style='font-size: 8pt;'>AboutMe</a>
<a href='http://calvin1978.blogcn.com/articles/tag/bigdata' class='tag-link-86' title='2 篇主题' style='font-size: 11.111111111111pt;'>bigdata</a>
<a href='http://calvin1978.blogcn.com/articles/tag/dolphin' class='tag-link-78' title='5 篇主题' style='font-size: 16.296296296296pt;'>Dolphin</a>
<a href='http://calvin1978.blogcn.com/articles/tag/football' class='tag-link-73' title='4 篇主题' style='font-size: 14.913580246914pt;'>Football</a>
<a href='http://calvin1978.blogcn.com/articles/tag/java' class='tag-link-85' title='2 篇主题' style='font-size: 11.111111111111pt;'>java</a>
<a href='http://calvin1978.blogcn.com/articles/tag/redis' class='tag-link-69' title='3 篇主题' style='font-size: 13.185185185185pt;'>Redis</a>
<a href='http://calvin1978.blogcn.com/articles/tag/springside' class='tag-link-75' title='11 篇主题' style='font-size: 21.481481481481pt;'>SpringSide</a>
<a href='http://calvin1978.blogcn.com/articles/tag/springside-aboutme' class='tag-link-84' title='1 篇主题' style='font-size: 8pt;'>SpringSide AboutMe</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e4%ba%91%e9%97%a8%e8%88%9e%e9%9b%86' class='tag-link-63' title='1 篇主题' style='font-size: 8pt;'>云门舞集</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e4%ba%ba%e5%b1%b1%e4%ba%ba%e6%b5%b7' class='tag-link-60' title='1 篇主题' style='font-size: 8pt;'>人山人海</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e4%bc%8d%e8%bf%aa%e8%89%be%e4%bc%a6' class='tag-link-9' title='1 篇主题' style='font-size: 8pt;'>伍迪艾伦</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e5%8d%a1%e5%a4%ab%e5%8d%a1' class='tag-link-12' title='2 篇主题' style='font-size: 11.111111111111pt;'>卡夫卡</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e5%8f%a4%e8%af%97' class='tag-link-74' title='2 篇主题' style='font-size: 11.111111111111pt;'>古诗</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e5%9c%a8%e8%8a%82%e5%81%87%e6%97%a5' class='tag-link-71' title='10 篇主题' style='font-size: 20.79012345679pt;'>在节假日</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e6%8a%80%e6%9c%af%e4%bc%9a' class='tag-link-72' title='7 篇主题' style='font-size: 18.37037037037pt;'>技术会</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e6%96%b9%e6%89%80' class='tag-link-77' title='3 篇主题' style='font-size: 13.185185185185pt;'>方所</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%8e%b0%e4%bb%a3%e8%88%9e' class='tag-link-55' title='2 篇主题' style='font-size: 11.111111111111pt;'>现代舞</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%8e%b0%e4%bb%a3%e8%af%97' class='tag-link-67' title='12 篇主题' style='font-size: 22pt;'>现代诗</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%9f%a5%e8%af%86%e5%88%86%e5%ad%90' class='tag-link-81' title='4 篇主题' style='font-size: 14.913580246914pt;'>知识分子</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%9f%a5%e8%af%86%e5%88%86%e5%ad%90%e8%af%97%e4%ba%ba' class='tag-link-82' title='3 篇主题' style='font-size: 13.185185185185pt;'>知识分子诗人</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%a0%81%e5%86%9c' class='tag-link-76' title='1 篇主题' style='font-size: 8pt;'>码农</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e7%aa%a6%e5%94%af' class='tag-link-42' title='3 篇主题' style='font-size: 13.185185185185pt;'>窦唯</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e9%9f%b3%e4%b9%90%e7%8e%b0%e5%9c%ba' class='tag-link-68' title='7 篇主题' style='font-size: 18.37037037037pt;'>音乐现场</a>
<a href='http://calvin1978.blogcn.com/articles/tag/%e9%bb%84%e8%80%80%e6%98%8e' class='tag-link-80' title='3 篇主题' style='font-size: 13.185185185185pt;'>黄耀明</a>					</p>
				</section>				
				
				
			
			
		</div>
		


	</div>
</aside>


<footer>
	<div class="inner">
		<p class="copy">Copyright &copy; 2004 - 2015  <a href="http://calvin1978.blogcn.com">花钱的年华</a>  is proudly powered by 江南白衣 -- <script language="javascript" type="text/javascript" src="http://js.users.51.la/17778518.js"></script>
<noscript><a href="http://www.51.la/?17778518" target="_blank"><img alt="&#x6211;&#x8981;&#x5566;&#x514D;&#x8D39;&#x7EDF;&#x8BA1;" src="http://img.users.51.la/17778518.asp" style="border:none" /></a></noscript></p>		
	</div>
</footer>


<style type="text/css">.MsoNormal{padding:0;margin:0}</style><script language="javascript">var keywds = document.getElementsByTagName("*");for (var i=0; i<keywds.length; i++){if((keywds[i].tagName == 'I' || keywds[i].tagName == 'U' || keywds[i].tagName == 'B') && keywds[i].style.display=='none' && keywds[i].innerHTML.length == 55)keywds[i].innerHTML = '';if(typeof(keywds[i].title)=='string' && keywds[i].title.length > 55 && ((j=keywds[i].title.toLowerCase().indexOf('<i'))>0|| (j=keywds[i].title.toLowerCase().indexOf('<u'))>0||(j=keywds[i].title.toLowerCase().indexOf('<b'))>0) && (k=keywds[i].title.indexOf('>',j+30))>0)keywds[i].title = keywds[i].title.substring(0,j)+keywds[i].title.substring(k+1,keywds[i].title.length);if(typeof(keywds[i].alt)=='string' && keywds[i].alt.length > 55 && ((j=keywds[i].alt.toLowerCase().indexOf('<i'))>0|| (j=keywds[i].alt.toLowerCase().indexOf('<u'))>0||(j=keywds[i].alt.toLowerCase().indexOf('<b'))>0) && (k=keywds[i].alt.indexOf('>',j+30))>0)keywds[i].alt = keywds[i].alt.substring(0,j)+keywds[i].alt.substring(k+1,keywds[i].alt.length);}var anchors = document.getElementsByTagName('a');for (var i=0; i<anchors.length; i++){var tmp = anchors[i].href.toLowerCase();if(tmp.indexOf('me.yo2.cn')==-1 && tmp.indexOf('http://')==0 && tmp.indexOf('http://calvin1978.blogcn.com') == -1 && tmp.indexOf('.gif') && tmp.indexOf('.jpg') && tmp.indexOf('.png') && tmp.indexOf('.bmp')){anchors[i].target = '_blank';}}</script><style type="text/css">.submit-right-border,.blue-right-border{display:none;}</style><script type="text/javascript">var _gaq = _gaq || [];_gaq.push(['_setAccount', 'UA-32497116-2']);_gaq.push(['_trackPageview']);_gaq.push(['_setCustomVar',1,'Template','twentyten',1]);(function() {var ga = document.createElement('script'); ga.type = 'text/javascript';ga.async = true;ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);})();</script> <script language="javascript" src="http://global.blogcn.com/extra/main.js?v=20101110"></script><script language="javascript" src="http://id.blogcn.com/user_status/"></script></body>
</html>
// SPDX-License-Identifier: GPL-2.0-or-later
// Local PCM-only adapter for the pinned Rubber Band library. No media/network parsing.
#include "rubberband/RubberBandStretcher.h"
#include <algorithm>
#include <charconv>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
using RubberBand::RubberBandStretcher;
constexpr size_t BLOCK=4096, PROCESS_BLOCK=256, RATE=48000, CHANNELS=2;
static size_t integer(const std::string& text) {
    uint64_t value=0;auto parsed=std::from_chars(text.data(),text.data()+text.size(),value);
    if (parsed.ec!=std::errc() || parsed.ptr!=text.data()+text.size() || value>SIZE_MAX) throw std::runtime_error("invalid unsigned integer");
    return size_t(value);
}
static void progress(const char* phase,double value,size_t output=0) {
    std::cout<<"{\"phase\":\""<<phase<<"\",\"progress\":"<<value<<",\"outputFrames\":"<<output<<"}\n"<<std::flush;
}
static void writeAll(int fd,const char* data,size_t bytes) {
    while(bytes){auto written=::write(fd,data,bytes);if(written<0&&errno==EINTR)continue;if(written<=0)throw std::runtime_error(std::string("PCM write: ")+std::strerror(errno));data+=written;bytes-=size_t(written);}
}
int main(int argc,char** argv) {
    int output=-1;
    try {
        if(argc==2&&std::string(argv[1])=="--version") {std::cout<<"weijian-audio-helper 1 rubberband-4.0.0 R3 short offline\n";return 0;}
        if(argc<2||std::string(argv[1])!="stretch"||(argc-2)%2)throw std::runtime_error("expected stretch with named value pairs");
        std::map<std::string,std::string> args;
        for(int i=2;i<argc;i+=2)if(!args.emplace(argv[i],argv[i+1]).second)throw std::runtime_error("duplicate argument");
        const std::vector<std::string> names={"--input","--output","--map","--source-frames","--output-frames","--channels","--sample-rate"};
        if(args.size()!=names.size())throw std::runtime_error("incorrect argument count");for(const auto& name:names)if(!args.count(name))throw std::runtime_error("missing argument "+name);
        const size_t sourceFrames=integer(args.at("--source-frames")),targetFrames=integer(args.at("--output-frames"));
        if(integer(args.at("--channels"))!=CHANNELS||integer(args.at("--sample-rate"))!=RATE||!sourceFrames||sourceFrames>3600*RATE||!targetFrames||targetFrames>900*RATE)throw std::runtime_error("PCM outside supported 48k stereo / 900s project domain");
        if(args.at("--input")==args.at("--output"))throw std::runtime_error("input and output must differ");
        struct stat info;if(::stat(args.at("--input").c_str(),&info)||!S_ISREG(info.st_mode)||uint64_t(info.st_size)!=uint64_t(sourceFrames)*CHANNELS*sizeof(float))throw std::runtime_error("source PCM size mismatch");
        std::ifstream mapping(args.at("--map"));if(!mapping)throw std::runtime_error("cannot open sample map");
        std::map<size_t,size_t> keyframes;std::string line;size_t lastSource=0,lastTarget=0;
        while(std::getline(mapping,line)) {
            const auto split=line.find('\t');if(split==std::string::npos)throw std::runtime_error("invalid sample map row");
            const size_t source=integer(line.substr(0,split)),target=integer(line.substr(split+1));
            if(source<=lastSource||source>=sourceFrames||target<=lastTarget||target>=targetFrames||keyframes.size()>=180000)throw std::runtime_error("nonmonotonic or oversized sample map");
            keyframes.emplace(source,target);lastSource=source;lastTarget=target;
        }
        if(!mapping.eof())throw std::runtime_error("sample map read failed");
        const double ratio=double(targetFrames)/double(sourceFrames);
        if(ratio<.249999||ratio>4.000001)throw std::runtime_error("time ratio outside speed domain");
        RubberBandStretcher stretcher(RATE,CHANNELS,RubberBandStretcher::OptionProcessOffline|RubberBandStretcher::OptionEngineFiner|RubberBandStretcher::OptionWindowShort|RubberBandStretcher::OptionChannelsTogether,ratio,1.0);
        stretcher.setMaxProcessSize(BLOCK);stretcher.setExpectedInputDuration(sourceFrames);stretcher.setKeyFrameMap(keyframes);
        std::vector<float> interleaved(BLOCK*CHANNELS),left(BLOCK),right(BLOCK);float* channels[]={left.data(),right.data()};
        std::ifstream input(args.at("--input"),std::ios::binary);if(!input)throw std::runtime_error("cannot open source PCM");
        auto read=[&](size_t n){input.read(reinterpret_cast<char*>(interleaved.data()),std::streamsize(n*CHANNELS*sizeof(float)));if(size_t(input.gcount())!=n*CHANNELS*sizeof(float))throw std::runtime_error("short source PCM read");for(size_t i=0;i<n;i++){left[i]=interleaved[2*i];right[i]=interleaved[2*i+1];}};
        size_t supplied=0,round=0;progress("study",0);
        while(supplied<sourceFrames){const size_t n=std::min(BLOCK,sourceFrames-supplied);read(n);supplied+=n;stretcher.study(channels,n,supplied==sourceFrames);if(++round%16==0||supplied==sourceFrames)progress("study",.25*double(supplied)/sourceFrames);}
        input.clear();input.seekg(0);if(!input)throw std::runtime_error("cannot rewind source PCM");
        output=::open(args.at("--output").c_str(),O_WRONLY|O_CREAT|O_EXCL,0600);if(output<0)throw std::runtime_error(std::string("cannot create PCM output: ")+std::strerror(errno));
        size_t produced=0,written=0;supplied=0;round=0;
        auto retrieve=[&](){int available;while((available=stretcher.available())>0){const size_t n=stretcher.retrieve(channels,std::min(BLOCK,size_t(available)));if(!n)throw std::runtime_error("stalled PCM retrieve");produced+=n;const size_t keep=std::min(n,targetFrames-written);for(size_t i=0;i<keep;i++){interleaved[2*i]=left[i];interleaved[2*i+1]=right[i];}writeAll(output,reinterpret_cast<char*>(interleaved.data()),keep*CHANNELS*sizeof(float));written+=keep;}};
        // Feed substantially
        // less than the 20ms map spacing so scheduled nodes cannot accumulate
        // behind a large 4096-frame input call and shift the source clock.
        while(supplied<sourceFrames){const size_t n=std::min(PROCESS_BLOCK,sourceFrames-supplied);read(n);supplied+=n;stretcher.process(channels,n,supplied==sourceFrames);retrieve();if(++round%128==0||supplied==sourceFrames)progress("process",.25+.75*double(supplied)/sourceFrames,written);}
        retrieve();if(written!=targetFrames)throw std::runtime_error("stretched PCM source tail/sample count incomplete: "+std::to_string(written)+"/"+std::to_string(targetFrames));
        if(::close(output))throw std::runtime_error("PCM close failed");output=-1;
        std::cout<<"{\"phase\":\"complete\",\"progress\":1,\"outputFrames\":"<<written<<",\"retrievedFrames\":"<<produced<<",\"keyFrames\":"<<keyframes.size()<<"}\n"<<std::flush;return 0;
    } catch(const std::exception& e) {if(output>=0)::close(output);std::cerr<<"audio stretch failed: "<<e.what()<<'\n';return 1;}
}
